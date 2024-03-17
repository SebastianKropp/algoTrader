const { GoogleGenerativeAI } = require("@google/generative-ai");

class GeminiHandler {
    constructor() {
        const MODEL_NAME = process.env.MODEL_NAME
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY

        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }

    async queryLLMRecommendation(stockInformation, inPortfolio=false) {
        let prompt = this.promptFormatter(stockInformation, inPortfolio)
        let response = await this.queryLLM(prompt)
        let formattedResponse = this.formatLLMResponse(response)
        return formattedResponse
    }

    async queryLLM(prompt) {
        const model = this.genAI.getGenerativeModel({ model: "gemini-1.0-pro-latest"});

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        return text

    }

    formatLLMResponse(response) {
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

    promptFormatter(stockInformation, inPortfolio=false) {
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
}