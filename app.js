// Import required modules
const express = require('express');
const finnhub = require('finnhub');
require('dotenv').config()
const { Pool } = require('pg');
// Create an instance of Express
const app = express();

var portfolio = {}
var portfolioValue = 0
var portfolioAvailableCash = 0

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
  


const API_KEY = process.env.API_KEY
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
const PORT = process.env.PORT

const api_key = finnhub.ApiClient.instance.authentications['api_key'];
api_key.apiKey = API_KEY
const finnhubClient = new finnhub.DefaultApi()

async function retrieveCurrentPortfolio() {
    // Retrieve the current portfolio from the database
    let text = ''
    try {
    text = 'SELECT * FROM portfolio';
    const response = await query(text);
    portfolioValue = 0
    for (let row of response) {
        portfolio[row.ticker] = {"price": row.price, "quantity": row.quantity}
        portfolioValue += row.value * row.quantity
    }

    //retrieve portfolioValue
    text = 'SELECT * FROM portfolioValue';
    const responseValue = await query(text);
    portfolioValue = responseValue.portfolioValue
    
    //retrieve portfolioAvailableCash
    text = 'SELECT * FROM portfolioAvailableCash';
    const responseCash = await query(text);
    portfolioAvailableCash = responseCash.portfolioAvailableCash

    
    } catch (err) {
        retrieveCurrentPortfolio()
    }
    return response;

}

async function updateCurrentPortfolio() {
    portfolioValue = 0
    for (let ticker in portfolio) {
        const response = await finnhubClient.quote(ticker)
        const data = await response.json()
        portfolio[ticker].price = data.last.price
        portfolioValue += data.last.price * portfolio[ticker].quantity
    }
    // Update the database with the new portfolio
    let text = 'DELETE FROM portfolio';
    await query(text);
    for (let ticker in portfolio) {
        text = 'INSERT INTO portfolio (ticker, price, quantity) VALUES ($1, $2, $3)';
        await query(text, [ticker, portfolio[ticker].price, portfolio[ticker].quantity]);
    }
    //update portfolioHistory
    text = 'INSERT INTO portfolioValue date, portfolioValue, availableCash) VALUES ($1, $2, $3)';
    await query(text, [Date.now(), portfolioValue, portfolioAvailableCash]);
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
                currentNews.push({headline: data[i].headline, url: data[i].url, summary: data[i].summary})
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
                "10DayAverageTradingVolume": data.metric['10DayAverageTradingVolume'],
                "52WeekHigh": data.metric['52WeekHigh'],
                "52WeekHighDate": data.metric['52WeekHighDate'],
                "52WeekLow": data.metric['52WeekLow'],
                "52WeekLowDate": data.metric['52WeekLowDate'],
                "beta": data.metric['beta'],
                "bookValuePerShareQuarterly": data.metric['bookValuePerShareQuarterly'],
                "currentRatioQuarterly": data.metric['currentRatioQuarterly'],
                "ebitdPerShareTTM": data.metric['ebitdPerShareTTM'],
                "epsAnnual": data.metric['epsAnnual'],
                "epsGrowthQuarterlyYoy": data.metric['epsGrowthQuarterlyYoy'],
                "psTTM": data.metric['psTTM'],
                "revenuePerShareTTM": data.metric['revenuePerShareTTM'],
                "roiTTM": data.metric['roiTTM']
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
                insiderTransactions.push({name: data[i].name, share: data[i].share, change: data[i].change})
            }
            resolve(insiderTransactions)
        }
    })});

    const recommendationsPromise = new Promise((resolve, reject) => {
        finnhubClient.recommendationTrends(ticker, (error, data, response) => {
        if (error) {
            reject(error);
        } else {
            let currentRecommendation = {buy: data[0].buy, hold: data[0].hold, sell: data[0].sell, strongBuy: data[0].strongBuy, strongSell: data[0].strongSell, period: data[0].period}
            resolve(currentRecommendation)
        }
    })});

    const quotePromise = new Promise((resolve, reject) => {
        finnhubClient.quote(ticker, (error, data, response) => {
        if (error) {
            reject(error);
        } else {
            let currentValues = {currentPrice: data.c, highDay: data.h, lowDay: data.l}
            resolve(currentValues)
        }
    })});

    await withTimeout(currentNewsPromise, 5000)
    .then((value) => {
        stockInformation.news = value
    })
    .catch((error) => {
        console.log("No news available")
    })

    await withTimeout(financialsPromise, 5000)
    .then((value) => {
        stockInformation.financials = value
    })
    .catch((error) => {
        console.log("No financials available")
    })

    await withTimeout(insiderTransactionsPromise, 5000)
    .then((value) => {
        stockInformation.insiderTransactions = value
    })
    .catch((error) => {
        console.log("No insider transactions available")
    })

    await withTimeout(recommendationsPromise, 5000)
    .then((value) => {
        stockInformation.recommendation = value
    })
    .catch((error) => {
        console.log("No recommendations available")
    })

    await withTimeout(quotePromise, 5000)
    .then((value) => {
        stockInformation.quote = value
    })
    .catch((error) => {
        console.log("No quote available")
    })
    stockInformation.ticker = ticker
    return stockInformation
}

function promptFormatter(stockInformation) {
    let prompt = `Here is the information for ${stockInformation.ticker} I want you to return the confidence of buying this stock based on the following information and telling me if you would buy, hold, or sell this stock. 
    Only tell me in this format: "[BUY || HOLD || SELL, decimal confidence 0-1]".
    Here is the information for ${stockInformation.ticker}:
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
    News: ${JSON.stringify(stockInformation.news) || null}
    Insider Transactions: ${JSON.stringify(stockInformation.insiderTransactions) || null}
    Recommendation: ${JSON.stringify(stockInformation.recommendation) || null}
    Quote: ${JSON.stringify(stockInformation.quote) || null}`
    return prompt
}
    

// Define a sample route
app.get('/', (req, res) => {
  res.send('Hello, World!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


// Example usage
async function main() {
    let currentTickerInformation = await currentTickerData('NVDA')
    let prompt = promptFormatter(currentTickerInformation)
    console.log(prompt)
    //  retrieveCurrentPortfolio()
    // console.log(portfolio)
    // console.log(portfolioValue)

}
  
main();