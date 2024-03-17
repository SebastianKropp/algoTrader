const finnhub = require('finnhub');
const { doRequest, withTimeout } = require('./utils')


class finnHubClient {
    constructor() {
        this.API_KEY = process.env.API_KEY
        this.FMP_API_KEY = process.env.FMP_API_KEY
        const api_key = finnhub.ApiClient.instance.authentications['api_key'];
        api_key.apiKey = this.API_KEY
        this.finnhubClient = new finnhub.DefaultApi()

    }


    async currentTickerData(ticker) {

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
                this.finnhubClient.companyNews(ticker, lastMonth, currentDate, (error, data, response) => {
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
                this.finnhubClient.companyBasicFinancials(ticker, "margin", (error, data, response) => {
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
                this.finnhubClient.insiderTransactions(ticker, (error, data, response) => {
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
                this.finnhubClient.recommendationTrends(ticker, (error, data, response) => {
                if (error) {
                    reject(error);
                } else {
                    let currentRecommendation = {buy: data[0]?.buy, hold: data[0]?.hold, sell: data[0]?.sell, strongBuy: data[0]?.strongBuy, strongSell: data[0]?.strongSell, period: data[0]?.period}
                    resolve(currentRecommendation)
                }
            })});

            const quotePromise = new Promise((resolve, reject) => {
                this.finnhubClient.quote(ticker, (error, data, response) => {
                if (error) {
                    reject(error);
                } else {
                    let currentValues = {currentPrice: data?.c, highDay: data?.h, lowDay: data?.l}
                    resolve(currentValues)
                }
            })});

            let promises = {news: currentNewsPromise, financials: financialsPromise, insiderTransactions: insiderTransactionsPromise, recommendation: recommendationsPromise, quote: quotePromise}
            for (let stockInfo in promises) {
                await withTimeout(promises[stockInfo], 5000)
                .then((value) => {
                    stockInformation[stockInfo] = value
                })
                .catch((error) => {
                    console.log("No Data Available For: ", ticker)
                })
            }
            return stockInformation
        }
        catch (err) {
            console.log("Error retrieving stock data for", ticker)
            console.log(err)
            return null
        }
    }

    async marketStatus() {

        const marketStatusPromise = new Promise((resolve, reject) => {
            this.finnhubClient.marketStatus("US", (error, data, response) => {
            if (error) {
                reject(error);
            } else {
                let marketOpen = data?.isOpen
                resolve(marketOpen)
            }
        })});
        let marketStatus = false
        await withTimeout(marketStatusPromise, 10000)
        .then((value) => {
            marketStatus = value
        })
        return marketStatus
    }

    async randomTrendingStocks(n) {
        let trendingStocks = []
        let selectedStocks = []
        const options = {
            hostname: 'financialmodelingprep.com',
            port: 443,
            path: `/api/v3/stock_market/actives?apikey=${this.FMP_API_KEY}`,
            method: 'GET'
        }

        trendingStocks = await doRequest(options);
        for (let i = 0; i < n; i+=1) {
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
}

module.exports.finnHubClient = new finnHubClient();