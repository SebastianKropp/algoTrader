// Import required modules
const express = require('express');
const finnhub = require('finnhub');
const nodemailer = require("nodemailer");
const { google } = require('googleapis');
const https = require('https')
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config()
const { Pool } = require('pg');
// Create an instance of Express
const app = express();

// Configure the PostgreSQL connection
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432, // Default PostgreSQL port is 5432
  });

// Function to execute a query
async function query(text, params) {
const client =  await pool.connect();
try {
    const result = await client.query(text, params);
    return result.rows;
} finally {
    client.release(); // Release the client back to the pool
}
}

/**
 * Do a request with options provided.
 *
 * @param {Object} options
 * @param {Object} data
 * @return {Promise} a promise of request
 */
function doRequest(options) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        res.setEncoding('utf8');
        let responseBody = '';
  
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
  
        res.on('end', () => {
          resolve(JSON.parse(responseBody));
        });
      });
  
      req.on('error', (err) => {
        reject(err);
      });
      req.end();
    });
  }

let portfolio = {}
let portfolioValue = 0
let portfolioAvailableCash = 0


const API_KEY = process.env.API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL_NAME = process.env.MODEL_NAME
const FMP_API_KEY = process.env.FMP_API_KEY
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
const PORT = process.env.PORT

const api_key = finnhub.ApiClient.instance.authentications['api_key'];
api_key.apiKey = API_KEY
const finnhubClient = new finnhub.DefaultApi()
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME});

async function retrieveCurrentPortfolio() {
    let portfolio = {}
    let portfolioValue = 0
    let portfolioAvailableCash = 0
    // Retrieve the current portfolio from the database
    let text = ''
    try {
    text = 'SELECT * FROM portfolio';
    const response = await query(text);
    portfolioValue = 0
    for (let row of response) {
        portfolio[row.ticker] = {"price": row.price, "quantity": row.quantity, "priceBoughtAverage": row.priceboughtaverage, "recommendation": row.recommendation, "confidence": row.confidence, "date": row.date}
    }

    //retrieve portfolioValue
    text = 'SELECT * FROM portfolioValue';
    const responseValue = await query(text);
    if (responseValue.length !== 0) {
        portfolioValue = responseValue[0].portfoliovalue || 0
    }
    else {
        portfolioValue = 0
    }
    
    //retrieve portfolioAvailableCash
    text = 'SELECT * FROM portfolioAvailableCash';
    const responseCash = await query(text);
    if (responseCash.length !== 0) {
        portfolioAvailableCash = responseCash[0].availablecash || 0
    }
    else {
        portfolioAvailableCash = 0
    
    }
} 
    catch (err) {
        console.log('retrying...')
        console.log(err)
        await new Promise(resolve => setTimeout(resolve, 5000));
        return retrieveCurrentPortfolio()
    }
    console.log("\nRetrieved Portfolio:\n", portfolio, "\nPortfolio Value:\n", portfolioValue, "\nPortfolio Available Cash:\n", portfolioAvailableCash)
    return {portfolio: portfolio, portfolioValue: portfolioValue, portfolioAvailableCash: portfolioAvailableCash};

}

async function updateCurrentPortfolio(portfolio, portfolioValue, portfolioAvailableCash) {
    function percentageGainStock(priceBoughtAverage, currentPrice) {
        return ((currentPrice - priceBoughtAverage) / priceBoughtAverage) * 100
    }
    function truncateDecimals(number, digits) {
        var multiplier = Math.pow(10, digits),
            adjustedNum = number * multiplier,
            truncatedNum = Math[adjustedNum < 0 ? 'ceil' : 'floor'](adjustedNum);
    
        return truncatedNum / multiplier;
    };
    
    function withTimeout(promise, timeout) {
        return Promise.race([
          promise,
          new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error('Timeout'));
            }, timeout);
          })
        ]);
    }
    portfolioValue = 0
    for (let ticker of Object.keys(portfolio)) {
        let tickerValue = 0
        const quotePromise = new Promise((resolve, reject) => {
            finnhubClient.quote(ticker, (error, data, response) => {
            if (error) {
                reject(error);
            } else {
                let currentValues = {currentPrice: data?.c, highDay: data?.h, lowDay: data?.l}
                resolve(currentValues)
            }
        })});
        await withTimeout(quotePromise, 5000)
        .then((value) => {
            tickerValue = value.currentPrice
        })
        portfolio[ticker].price = tickerValue
        portfolioValue += tickerValue * portfolio[ticker].quantity
    }
    // Update the database with the new portfolio
    let text = 'DELETE FROM portfolio';
    await query(text);
    for (let ticker in portfolio) {
        text = 'INSERT INTO portfolio (ticker, price, priceboughtaverage, quantity, recommendation, confidence, date) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        await query(text, [ticker, portfolio[ticker].price, portfolio[ticker].priceBoughtAverage, portfolio[ticker].quantity, portfolio[ticker].recommendation, portfolio[ticker].confidence, portfolio[ticker].date]);
    }
    text = 'DELETE FROM portfolioValue';
    await query(text);
    //update portfolioValue
    text = 'INSERT INTO portfolioValue (portfoliovalue) VALUES ($1)';
    await query(text, [portfolioValue]);
    text = 'DELETE FROM portfolioAvailableCash';
    await query(text);
    text = 'INSERT INTO portfolioAvailableCash (availablecash) VALUES ($1)';
    await query(text, [portfolioAvailableCash]);

    //update portfolioHistory
    text = 'INSERT INTO portfolioHistory (date, portfolioValue, availableCash) VALUES ($1, $2, $3)';
    await query(text, [new Date().toISOString(), portfolioValue, portfolioAvailableCash]);
    //console.log("\nUpdated Portfolio:\n", portfolio, "\nPortfolio Value:\n", portfolioValue, "\nPortfolio Available Cash:\n", portfolioAvailableCash)
    let percentageGainOrLoss = truncateDecimals(((portfolioValue + portfolioAvailableCash - 10000)/ 10000) * 100, 3)
    let percentageDifferencePerStock = ''
    for (let ticker in portfolio) {
        let percentageDifference = percentageGainStock(portfolio[ticker].priceBoughtAverage, portfolio[ticker].price)
        let percentageWord = percentageDifference > 0 ? "gain" : "loss"
        percentageDifferencePerStock += `\n        ${ticker} has a ${percentageWord} of ${truncateDecimals(percentageDifference, 1)}% for a value difference of ${truncateDecimals(portfolio[ticker].quantity*portfolio[ticker].price - portfolio[ticker].quantity*portfolio[ticker].priceBoughtAverage, 2)}\n`
    }
    let oofMeter = ''
    if (percentageGainOrLoss > 0) {
        let oofMeter = 'Nice! You\'re kinda good gemini'
    }
    else {
        let oofMeter = 'Oof! You\'re kinda trash gemini'
    }
    let currentPortfolioString = ``
    for (let ticker in portfolio) {
        currentPortfolioString += `\n        ${ticker} bought @ ${portfolio[ticker].priceBoughtAverage} and a quantity of ${portfolio[ticker].quantity} for a total value of ${portfolio[ticker].price * portfolio[ticker].quantity}\n        Confidence of ${portfolio[ticker].confidence} and a recommendation of ${portfolio[ticker].recommendation} on ${portfolio[ticker].date.toISOString()}\n`
    }



        console.log(
        `
        -------------------------
        --- Portfolio Updated ---
        -------------------------
        - Total Portfolio Value -
        -------------------------
        $${truncateDecimals(portfolioValue + portfolioAvailableCash, 2)} in Total
        $${truncateDecimals(portfolioValue, 2)} in Stock
        $${truncateDecimals(portfolioAvailableCash, 2)} in Cash
        -------------------------
        Percentage Change: ${percentageGainOrLoss}% Value Difference: ${truncateDecimals(portfolioValue + portfolioAvailableCash - 10000, 2)}
        ${percentageDifferencePerStock}
        ${oofMeter}
        `)
    console.log(
        `
        -------------------------
        --- Current Portfolio ---
        -------------------------
        ${currentPortfolioString}
        -------------------------
        `
    )

    return {portfolio: portfolio, portfolioValue: portfolioValue, portfolioAvailableCash: portfolioAvailableCash};

}

async function currentTickerData(ticker) {

    function withTimeout(promise, timeout) {
        return Promise.race([
          promise,
          new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error('Timeout'));
            }, timeout);
          })
        ]);
    }

    try {
        //currentDate
        let currentDate = new Date()
        //current date minus 1 month
        let lastMonth = new Date()
        lastMonth.setMonth(lastMonth.getMonth() - 1)
        currentDate = currentDate.toISOString().split('T')[0]
        lastMonth = lastMonth.toISOString().split('T')[0]
        let stockInformation = {
            financials: {
                "10DayAverageTradingVolume": 0,
                "52WeekHigh": 0,
                "52WeekHighDate": "",
                "52WeekLow": 0,
                "52WeekLowDate": "",
                "beta": 0,
                "bookValuePerShareQuarterly": 0,
                "currentRatioQuarterly": 0,
                "ebitdPerShareTTM": 0,
                "epsAnnual": 0,
                "epsGrowthQuarterlyYoy": 0,
                "psTTM": 0,
                "revenuePerShareTTM": 0,
                "roiTTM": 0
            },
            news: [],
            insiderTransactions: [],
            recommendation: {
                "buy": 0,
                "hold": 0,
                "sell": 0,
                "strongBuy": 0,
                "strongSell": 0,
                "period": ""
            },
            quote: {
                "currentPrice": 0,
                "highDay": 0,
                "lowDay": 0
            }
        }

        const currentNewsPromise = new Promise((resolve, reject) => {
            finnhubClient.companyNews(ticker, lastMonth, currentDate, (error, data, response) => {
            if (error) {
                reject(error);
            } else {
                //First 3 articles
                let currentNews = []
                for (let i = 0; i < 3; i++) {
                    currentNews.push({headline: data[i]?.headline, url: data[i]?.url, summary: data[i]?.summary})
                }
                resolve(currentNews)
            }
        })});

        const financialsPromise = new Promise((resolve, reject) => {
            finnhubClient.companyBasicFinancials(ticker, "margin", (error, data, response) => {
            if (error) {
                reject(error);
            } else {
                let currentFinancials = {
                    "10DayAverageTradingVolume": data?.metric['10DayAverageTradingVolume'],
                    "52WeekHigh": data?.metric['52WeekHigh'],
                    "52WeekHighDate": data?.metric['52WeekHighDate'],
                    "52WeekLow": data?.metric['52WeekLow'],
                    "52WeekLowDate": data?.metric['52WeekLowDate'],
                    "beta": data?.metric['beta'],
                    "bookValuePerShareQuarterly": data?.metric['bookValuePerShareQuarterly'],
                    "currentRatioQuarterly": data?.metric['currentRatioQuarterly'],
                    "ebitdPerShareTTM": data?.metric['ebitdPerShareTTM'],
                    "epsAnnual": data?.metric['epsAnnual'],
                    "epsGrowthQuarterlyYoy": data?.metric['epsGrowthQuarterlyYoy'],
                    "psTTM": data?.metric['psTTM'],
                    "revenuePerShareTTM": data?.metric['revenuePerShareTTM'],
                    "roiTTM": data?.metric['roiTTM']
                }
                resolve(currentFinancials)
            }
        })});

        const insiderTransactionsPromise = new Promise((resolve, reject) => {
            finnhubClient.insiderTransactions(ticker, (error, data, response) => {
            if (error) {
                reject(error);
            } else {
                let insiderTransactions = []
                for (let i = 0; i < 3; i++) {
                    insiderTransactions.push({name: data[i]?.name, share: data[i]?.share, change: data[i]?.change})
                }
                resolve(insiderTransactions)
            }
        })});

        const recommendationsPromise = new Promise((resolve, reject) => {
            finnhubClient.recommendationTrends(ticker, (error, data, response) => {
            if (error) {
                reject(error);
            } else {
                let currentRecommendation = {buy: data[0]?.buy, hold: data[0]?.hold, sell: data[0]?.sell, strongBuy: data[0]?.strongBuy, strongSell: data[0]?.strongSell, period: data[0]?.period}
                resolve(currentRecommendation)
            }
        })});

        const quotePromise = new Promise((resolve, reject) => {
            finnhubClient.quote(ticker, (error, data, response) => {
            if (error) {
                reject(error);
            } else {
                let currentValues = {currentPrice: data?.c, highDay: data?.h, lowDay: data?.l}
                resolve(currentValues)
            }
        })});

        await withTimeout(currentNewsPromise, 5000)
        .then((value) => {
            stockInformation.news = value
        })
        .catch((error) => {
            console.log("No News Available For: ", ticker)
        })

        await withTimeout(financialsPromise, 5000)
        .then((value) => {
            stockInformation.financials = value
        })
        .catch((error) => {
            console.log("No Financials Available For: ", ticker)
        })

        await withTimeout(insiderTransactionsPromise, 5000)
        .then((value) => {
            stockInformation.insiderTransactions = value
        })
        .catch((error) => {
            console.log("No Insider Transactions Available For: ", ticker)
        })

        await withTimeout(recommendationsPromise, 5000)
        .then((value) => {
            stockInformation.recommendation = value
        })
        .catch((error) => {
            console.log("No Recommendations Available For: ", ticker)
        })

        await withTimeout(quotePromise, 5000)
        .then((value) => {
            stockInformation.quote = value
        })
        .catch((error) => {
            console.log("No Quote Available For: ", ticker)
        })
        stockInformation.ticker = ticker
        return stockInformation
    }
    catch (err) {
        console.log("Error Retrieving Current Ticker Data")
        return null

    }
}

function promptFormatter(stockInformation, inPortfolio=false) {
    let portfolioInformation = ``
    if (inPortfolio) {
        let percentageDifference = ((stockInformation.quote.currentPrice - portfolio[stockInformation.ticker].priceBoughtAverage) / portfolio[stockInformation.ticker].price) * 100
        let percentageWord = percentageDifference > 0 ? "gain" : "loss"
        portfolioInformation = 
        `This stock is currently in your portfolio. You have ${portfolio[stockInformation.ticker].quantity} shares of ${stockInformation.ticker} at a price of ${portfolio[stockInformation.ticker].priceBoughtAverage} per share. 
        This is currently a ${percentageWord} of ${percentageDifference}% at the current market value.
        Your last recommendation was to ${portfolio[stockInformation.ticker].recommendation} with a confidence of ${portfolio[stockInformation.ticker].confidence} on ${portfolio[stockInformation.ticker].date}.
        `
    }
    else {
        portfolioInformation = `This stock is not currently in your portfolio.`
    }
    let prompt = 
    `Here is the information for ${stockInformation.ticker} I want you to return the confidence of buying this stock based on the following information.
    Tell me if you would buy, hold, or sell this stock. 
    !IMPORTANT! Only reply to this prompt in this format: ["BUY" || "HOLD" || "SELL", decimal confidence 0-1].
    ${portfolioInformation}
    Here is the current information for ${stockInformation.ticker}:
    The Current Date Is: ${new Date().toISOString().split('T')[0]} 
    10 Day Average Trading Volume: ${stockInformation.financials["10DayAverageTradingVolume"]}
    52 Week High: ${stockInformation.financials["52WeekHigh"]} on ${stockInformation.financials["52WeekHighDate"]}
    52 Week Low: ${stockInformation.financials["52WeekLow"]} on ${stockInformation.financials["52WeekLowDate"]}
    Beta: ${stockInformation.financials["beta"]}
    Book Value Per Share Quarterly: ${stockInformation.financials["bookValuePerShareQuarterly"]}
    Current Ratio Quarterly: ${stockInformation.financials["currentRatioQuarterly"]}
    EBITD Per Share TTM: ${stockInformation.financials["ebitdPerShareTTM"]}
    EPS Annual: ${stockInformation.financials["epsAnnual"]}
    EPS Growth Quarterly Yoy: ${stockInformation.financials["epsGrowthQuarterlyYoy"]}
    PS TTM: ${stockInformation.financials["psTTM"]}
    Revenue Per Share TTM: ${stockInformation.financials["revenuePerShareTTM"]}
    ROI TTM: ${stockInformation.financials["roiTTM"]}
    News: ${JSON.stringify(stockInformation.news)}
    Insider Transactions: ${JSON.stringify(stockInformation.insiderTransactions)}
    Recommendation: ${JSON.stringify(stockInformation.recommendation)}
    Quote: ${JSON.stringify(stockInformation.quote)}
    Remember! Only reply with: ["BUY" || "HOLD" || "SELL", decimal confidence 0-1]`
    return prompt
}

async function queryLLM(prompt) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro-latest"});

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return text

}

function formatLLMResponse(response) {
    try {
        let beginningIndex = response.indexOf("[")
        let endingIndex = response.indexOf("]")
        let formattedResponse = response.substring(beginningIndex, endingIndex+1)
        return JSON.parse(formattedResponse)

    }
    catch (err) {
        console.log("\n\nError formatting LLM response, improper response format")
        console.log("Response:", response)
        return []
    }

}

async function stockRecommendation(ticker, attempts=0, average=[]) {

    function truncateDecimals(number, digits) {
        var multiplier = Math.pow(10, digits),
            adjustedNum = number * multiplier,
            truncatedNum = Math[adjustedNum < 0 ? 'ceil' : 'floor'](adjustedNum);
    
        return truncatedNum / multiplier;
    };
    
    function congregateRecommendations(recommendations) {
        let action = ''
        let confidenceAverage = 0
        for (let index in recommendations) {
            if (action !== '' && action !== recommendations[index].action[0]) {
                console.log("Not Enough Confidence To Create An Action: ", ticker)
                return {"ticker": ticker, "action": []}
            }
            action = recommendations[index].action[0]
            confidenceAverage += recommendations[index].action[1]
        }
        confidenceAverage = confidenceAverage / recommendations.length
        console.log("Congregate Recommendations: ", {"ticker": ticker, "action": [action, truncateDecimals(confidenceAverage, 3)]})
        return {"ticker": ticker, "action": [action, truncateDecimals(confidenceAverage, 3)], "price": recommendations[0].price}
    }
    if (attempts > 3) {
        console.log("Exceeded maximum attempts to retrieve stock recommendation for", ticker)
        return {"ticker": ticker, "action": []}
    }
    try {
        console.log("Retrieving stock financials for", ticker)
        let stockInformation = await currentTickerData(ticker)
        let prompt = promptFormatter(stockInformation)
        //console.log("\nFormatted Financials:\n", prompt)
        if (stockInformation === null) {
            return {"ticker": ticker, "action": []}
        }
        for (let i = 0; i < 3; i+=1) {
            if (average.length >= 3) {
                return congregateRecommendations(average)
            }
            let response = await queryLLM(prompt)
            let formattedResponse = formatLLMResponse(response)
            //console.log("\nLLM Response: ", ticker, formattedResponse, "\n")
            average.push({"ticker": ticker, "action": formattedResponse, "price": stockInformation.quote.currentPrice})
        }
        return congregateRecommendations(average)
    }

    catch (err) {
        console.log("Error retrieving stock recommendation for", ticker)
        console.log(err)
        //make timeout a promise to await and return
        await new Promise(resolve => setTimeout(resolve, 10000));
        // Retry the function recursively
        return stockRecommendation(ticker, attempts + 1, average);

    }

}

function calculateSellQuantity(quantity, confidenceInterval, availableCash) {
    // Clamp confidence between 0-1 for safety
    const confidence = Math.max(0, Math.min(1, confidenceInterval));
  
    // Selling scales more aggressively with confidence
    const sellMultiplier = confidence ** 2; // Quadratic curve for stronger selling at higher confidence
  
    // Calculate the maximum safe sell amount, ensuring we don't oversell
    const maxSellAmount = Math.min(quantity, availableCash * 0.85); // Leave 15% buffer for safety
  
    // Return the quantity to sell
    return Math.round(sellMultiplier * maxSellAmount); 
  }
  
  function calculateBuyQuantity(confidenceInterval, availableCash, price) {
    // Clamp confidence between 0-1 for safety
    const confidence = Math.max(0, Math.min(1, confidenceInterval));
  
    // Buying scales linearly with confidence 
    const buyMultiplier = confidence; 
  
    // Calculate the maximum we can spend based on our 15% available cash limit
    const maxSpend = availableCash * 0.15; 
  
    // Calculate the maximum quantity we can buy
    const maxBuyQuantity = Math.floor(maxSpend / price);
  
    // Return the quantity to buy
    return Math.round(buyMultiplier * maxBuyQuantity); 
  }

async function collectAndExecuteStockActions(portfolio, portfolioValue, portfolioAvailableCash) {
    let selectedStocks = await randomTrendingStocks(5)
    if (Object.keys(portfolio).length > 0) {
        for(let ticker of Object.keys(portfolio)) {
            selectedStocks.push(ticker)
        }
    }
    let recommendations = []
    console.log('\nCurrently Selected Stocks For Filtering: ', selectedStocks)
    
    for (let stock of selectedStocks) {
        let recommendation = await stockRecommendation(stock)
        if (recommendation !== undefined && recommendation.action.length > 0) {
        recommendations.push(recommendation)
        }
    }
    console.log("\nThe filtered Recommendations Are:", recommendations)
    //Buy Stock if it is not in portfolio and sell if it is
    for (let recommendation of recommendations) {
        if (recommendation.action[0] === 'BUY' && portfolio?.[recommendation.ticker] === undefined) {
            let buyQuantity = calculateBuyQuantity(recommendation.action[1], portfolioAvailableCash, recommendation.price)
            console.log("\nBuying", buyQuantity, "shares of", recommendation.ticker)
            // Add to portfolio
            portfolio[recommendation.ticker] = {price: recommendation.price, quantity: buyQuantity, priceBoughtAverage: recommendation.price, recommendation: recommendation.action[0], confidence: recommendation.action[1], date: new Date().toISOString()}
            portfolioAvailableCash -= buyQuantity * recommendation.price
        }
        if (recommendation.action[0] === 'SELL' && portfolio?.[recommendation.ticker] !== undefined) {
            let sellQuantity = calculateSellQuantity(portfolio[recommendation.ticker].quantity, recommendation.action[1], portfolioAvailableCash)
            console.log("\nSelling", sellQuantity, "shares of", recommendation.ticker)
            // Remove from portfolio
            if (sellQuantity === portfolio[recommendation.ticker].quantity) {
                delete portfolio[recommendation.ticker]
            }
            else {
                portfolio[recommendation.ticker].quantity -= sellQuantity
            }
            portfolioAvailableCash += sellQuantity * recommendation.price
        }
    }
    return {portfolio: portfolio, portfolioValue: portfolioValue, portfolioAvailableCash: portfolioAvailableCash}
}

async function marketStatus() {

    function withTimeout(promise, timeout) {
        return Promise.race([
          promise,
          new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error('Timeout'));
            }, timeout);
          })
        ]);
    }

    const marketStatusPromise = new Promise((resolve, reject) => {
        finnhubClient.marketStatus("US", (error, data, response) => {
        if (error) {
            reject(error);
        } else {
            let marketOpen = data?.isOpen
            return marketOpen
        }
    })});

    await withTimeout(marketStatusPromise, 5000)
    .then((value) => {
        return value
    })
}

async function randomTrendingStocks(n) {
    let trendingStocks = []
    let selectedStocks = []
    const options = {
        hostname: 'financialmodelingprep.com',
        port: 443,
        path: `/api/v3/stock_market/actives?apikey=${FMP_API_KEY}`,
        method: 'GET'
    }

    trendingStocks = await doRequest(options);
    for (i = 0; i < n; i+=1) {
        let randomIndex = Math.floor(Math.random() * trendingStocks.length)
        if (!trendingStocks[randomIndex]["symbol"].includes(".") && !trendingStocks[randomIndex]["symbol"].includes("-")){
            let randomTicker = trendingStocks[randomIndex]["symbol"]
            if (selectedStocks.includes(randomTicker)) {
                i-=1
            }
            else {
                selectedStocks.push(randomTicker)
            }
        }
        else {
            console.log("\nNot a valid stock exchange", trendingStocks[randomIndex]["symbol"])
            i-=1
        }
    }

    return selectedStocks
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


// Example usage
async function main() {
    let updatedPortfolio = await retrieveCurrentPortfolio()
    .catch((err) => {
        console.log("Error retrieving current portfolio")
    })
    //set interval to 10 seconds
    async function intervalFunc(updatedPortfolio) {
        console.log("The Portfolio Is:", updatedPortfolio)
        if (Object.keys(updatedPortfolio.portfolio).length !== 0) {
            await updateCurrentPortfolio(updatedPortfolio.portfolio, updatedPortfolio.portfolioValue, updatedPortfolio.portfolioAvailableCash)
        }
        else if (Object.keys(updatedPortfolio.portfolio).length === 0 && updatedPortfolio.portfolioAvailableCash === 0){
            console.log("No portfolio found, skipping update...")
            console.log("Adding money to portfolio...")
            updatedPortfolio.portfolio = {}
            updatedPortfolio.portfolioValue = 0
            updatedPortfolio.portfolioAvailableCash = 10000
        }
        updatedPortfolio = await collectAndExecuteStockActions(updatedPortfolio.portfolio, updatedPortfolio.portfolioValue, updatedPortfolio.portfolioAvailableCash)
        console.log("The Portfolio Is:", updatedPortfolio)
        updatedPortfolio = await updateCurrentPortfolio(updatedPortfolio.portfolio, updatedPortfolio.portfolioValue, updatedPortfolio.portfolioAvailableCash)
        console.log("The Portfolio Is:", updatedPortfolio)
        //create a timer
        await new Promise(resolve => setTimeout(resolve, 60000));
        intervalFunc(updatedPortfolio)
    }
    intervalFunc(updatedPortfolio)

}
  
main();