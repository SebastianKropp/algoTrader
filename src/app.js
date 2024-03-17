require('dotenv').config()
let emailClient = require('./emailClient').emailClient
let finnHubClient = require('./finHubClient').finnHubClient
let postgresClient = require('./postgresClient').postgresClient
let geminiHandler = require('./geminiHandler').geminiHandler

async function stockRecommendation(ticker, attempts=0, average=[]) {
    
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
        let stockInformation = await finnHubClient.currentTickerData(ticker)
        for (let i = 0; i < 3; i+=1) {
            if (average.length >= 3) {
                return congregateRecommendations(average)
            }
            let formattedResponse = await geminiHandler.queryLLMRecommendation(stockInformation)
            average.push({"ticker": ticker, "action": formattedResponse, "price": stockInformation.quote.currentPrice})
        }
        return congregateRecommendations(average)
    }

    catch (err) {
        console.log("Error retrieving stock recommendation for", ticker)
        console.log(err)
        //make timeout a promise to await and return because gemini is overloaded
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
    return buyMultiplier * maxBuyQuantity
}

// Example usage
async function main() {
    // Retrieve the current portfolio from the database
    let {portfolio, portfolioValue, portfolioAvailableCash} = await postgresClient.retrieveCurrentPortfolio()
    let updatedPortfolio = {portfolio: portfolio, portfolioValue: portfolioValue, portfolioAvailableCash: portfolioAvailableCash}
    //set interval to 10 seconds
    async function intervalFunc(updatedPortfolio) {
        let isOpen = await finnHubClient.marketStatus()

        //if (isOpen) {
            if (Object.keys(updatedPortfolio.portfolio).length !== 0) {
                await postgresClient.updateCurrentPortfolio(updatedPortfolio.portfolio, updatedPortfolio.portfolioValue, updatedPortfolio.portfolioAvailableCash)
            }
            else if (Object.keys(updatedPortfolio.portfolio).length === 0 && updatedPortfolio.portfolioAvailableCash === 0){
                console.log("No portfolio found, skipping update...")
                console.log("Adding money to portfolio...")
                updatedPortfolio.portfolio = {}
                updatedPortfolio.portfolioValue = 0
                updatedPortfolio.portfolioAvailableCash = 10000
            }
            //Check 5 trending tickers for recommendation
            let randomTrendingStocks = await finnHubClient.randomTrendingStocks(5)

            //append portfolio tickers for updating recommendations
            if (Object.keys(updatedPortfolio.portfolio).length > 0) {
                for(let ticker of Object.keys(updatedPortfolio.portfolio)) {
                    randomTrendingStocks.push(ticker)
                }
            }

            let recommendations = []
            console.log('\nCurrently Selected Stocks For Filtering: ', randomTrendingStocks)
            //Get recommendations for each ticker
            for (let stock of randomTrendingStocks) {
                let recommendation = await stockRecommendation(stock)
                if (recommendation !== undefined && recommendation.action.length > 0) {
                recommendations.push(recommendation)
                }
            }
            console.log("\nThe filtered Recommendations Are:", recommendations)

            let actions = []
            for (let recommendation of recommendations) {
                //Keep it simple, only buy if it's not in portfolio and sell if it is
                if (recommendation.action[0] === 'BUY' && updatedPortfolio.portfolio?.[recommendation.ticker] === undefined) {
                    let buyQuantity = calculateBuyQuantity(recommendation.action[1], updatedPortfolio.portfolioAvailableCash, recommendation.price)
                    console.log("\nBuying", buyQuantity, "shares of", recommendation.ticker)
                    // Add to portfolio
                    updatedPortfolio.portfolio[recommendation.ticker] = {price: recommendation.price, quantity: buyQuantity, priceBoughtAverage: recommendation.price, recommendation: recommendation.action[0], confidence: recommendation.action[1], date: new Date().toISOString()}
                    updatedPortfolio.portfolioAvailableCash -= buyQuantity * recommendation.price
                    actions.push({ticker: recommendation.ticker, action: recommendation.action[0], quantity: buyQuantity})
                }
                if (recommendation.action[0] === 'SELL' && updatedPortfolio.portfolio?.[recommendation.ticker] !== undefined) {
                    let sellQuantity = calculateSellQuantity(updatedPortfolio.portfolio[recommendation.ticker].quantity, recommendation.action[1], updatedPortfolio.portfolioAvailableCash)
                    console.log("\nSelling", sellQuantity, "shares of", recommendation.ticker)
                    // Remove from portfolio
                    if (sellQuantity >= updatedPortfolio.portfolio[recommendation.ticker].quantity) {
                        delete updatedPortfolio.portfolio[recommendation.ticker]
                    }
                    else {
                        updatedPortfolio.portfolio[recommendation.ticker].quantity -= sellQuantity
                    }
                    updatedPortfolio.portfolioAvailableCash += sellQuantity * recommendation.price
                    actions.push({ticker: recommendation.ticker, action: recommendation.action[0], quantity: sellQuantity})
                }
            }

            let currentPortfolioString = ``
            for (let ticker in portfolio) {
                currentPortfolioString += `\n        ${ticker} bought @ ${portfolio[ticker].priceBoughtAverage} and a quantity of ${portfolio[ticker].quantity} for a total value of ${portfolio[ticker].price * portfolio[ticker].quantity}\n        Confidence of ${portfolio[ticker].confidence} and a recommendation of ${portfolio[ticker].recommendation} on ${portfolio[ticker].date.toISOString()}\n`
            }

            let portfolioUpdate = 
                `
                ------------------------------
                --- Portfolio Updated ---
                ------------------------------
                - Total Portfolio Value -
                -----------------------------
                $${truncateDecimals(portfolioValue + portfolioAvailableCash, 2)} in Total
                $${truncateDecimals(portfolioValue, 2)} in Stock
                $${truncateDecimals(portfolioAvailableCash, 2)} in Cash
                -----------------------------
                Percentage Change: ${percentageGainOrLoss}% Value Difference: ${truncateDecimals(portfolioValue + portfolioAvailableCash - 10000, 2)}
                ${percentageDifferencePerStock}`
            let portfolioStocks=
                `
                -----------------------------
                --- Current Portfolio ---
                -----------------------------
                ${currentPortfolioString}
                -----------------------------`
            let actionString = 
                `
                -----------------------------
                --- Current Actions ---
                -----------------------------
                ${actions.map((action) => `\n\n${action.ticker} ${action.action} ${action.quantity}`).join('')}
                -----------------------------`


            console.log(portfolioUpdate)
            console.log(portfolioStocks)

            let formattedEmail = `${portfolioUpdate}\n${portfolioStocks}\n${actionString}`

            emailClient.sendEmail(`Portfolio Update: ${new Date().toLocaleString()}`, formattedEmail)

            updatedPortfolio = await postgresClient.updateCurrentPortfolio(updatedPortfolio.portfolio, updatedPortfolio.portfolioValue, updatedPortfolio.portfolioAvailableCash)
        //}
        //create a timer
        await new Promise(resolve => setTimeout(resolve, 3600000));
        intervalFunc(updatedPortfolio)

    }
    intervalFunc(updatedPortfolio)

}
  
main();