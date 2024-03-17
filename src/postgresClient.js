const { Pool } = require('pg');
require('dotenv').config()
const { finnhubClient } = require('./finHubClient').finnHubClient
const { withTimeout, truncateDecimals } = require('./utils')

class postgresClient {
    constructor() {
        this.pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT || 5432, // Default PostgreSQL port is 5432
        });
    }
  
    // Function to execute a query
    async query(text, params) {
        const client =  await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result.rows;
        } 
        finally {
            client.release(); // Release the client back to the pool
        }
    }

    async retrieveCurrentPortfolio() {
        let portfolio = {}
        let portfolioValue = 0
        let portfolioAvailableCash = 0
        // Retrieve the current portfolio from the database
        let text = ''
        try {
        text = 'SELECT * FROM portfolio';
        const response = await this.query(text);
        portfolioValue = 0
        for (let row of response) {
            portfolio[row.ticker] = {"price": row.price, "quantity": row.quantity, "priceBoughtAverage": row.priceboughtaverage, "recommendation": row.recommendation, "confidence": row.confidence, "date": row.date}
        }

        //retrieve portfolioValue
        text = 'SELECT * FROM portfolioValue';
        const responseValue = await this.query(text);
        if (responseValue.length !== 0) {
            portfolioValue = responseValue[0].portfoliovalue || 0
        }
        else {
            portfolioValue = 0
        }
        
        //retrieve portfolioAvailableCash
        text = 'SELECT * FROM portfolioAvailableCash';
        const responseCash = await this.query(text);
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

    async updateCurrentPortfolio(portfolio, portfolioValue, portfolioAvailableCash) {
        function percentageGainStock(priceBoughtAverage, currentPrice) {
            return ((currentPrice - priceBoughtAverage) / priceBoughtAverage) * 100
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
        await this.query(text);
        for (let ticker in portfolio) {
            text = 'INSERT INTO portfolio (ticker, price, priceboughtaverage, quantity, recommendation, confidence, date) VALUES ($1, $2, $3, $4, $5, $6, $7)';
            await this.query(text, [ticker, portfolio[ticker].price, portfolio[ticker].priceBoughtAverage, portfolio[ticker].quantity, portfolio[ticker].recommendation, portfolio[ticker].confidence, portfolio[ticker].date]);
        }
        text = 'DELETE FROM portfolioValue';
        await this.query(text);
        //update portfolioValue
        text = 'INSERT INTO portfolioValue (portfoliovalue) VALUES ($1)';
        await this.query(text, [portfolioValue]);
        text = 'DELETE FROM portfolioAvailableCash';
        await this.query(text);
        text = 'INSERT INTO portfolioAvailableCash (availablecash) VALUES ($1)';
        await this.query(text, [portfolioAvailableCash]);

        //update portfolioHistory
        text = 'INSERT INTO portfolioHistory (date, portfolioValue, availableCash) VALUES ($1, $2, $3)';
        await this.query(text, [new Date().toISOString(), portfolioValue, portfolioAvailableCash]);
        //console.log("\nUpdated Portfolio:\n", portfolio, "\nPortfolio Value:\n", portfolioValue, "\nPortfolio Available Cash:\n", portfolioAvailableCash)
        let percentageGainOrLoss = truncateDecimals(((portfolioValue + portfolioAvailableCash - 10000)/ 10000) * 100, 3)
        let percentageDifferencePerStock = ''
        for (let ticker in portfolio) {
            let percentageDifference = percentageGainStock(portfolio[ticker].priceBoughtAverage, portfolio[ticker].price)
            let percentageWord = percentageDifference > 0 ? "gain" : "loss"
            percentageDifferencePerStock += `\n        ${ticker} has a ${percentageWord} of ${truncateDecimals(percentageDifference, 1)}% for a value difference of ${truncateDecimals(portfolio[ticker].quantity*portfolio[ticker].price - portfolio[ticker].quantity*portfolio[ticker].priceBoughtAverage, 2)}\n`
        }
        
        return {portfolio: portfolio, portfolioValue: portfolioValue, portfolioAvailableCash: portfolioAvailableCash};

    }
}

module.exports.postgresClient = new postgresClient();