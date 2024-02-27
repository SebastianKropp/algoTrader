-- Create a table named 'portfolio'
CREATE TABLE IF NOT EXISTS portfolio (
    ticker VARCHAR(4) PRIMARY KEY,
    price DOUBLE PRECISION NOT NULL,
    priceBoughtAverage DOUBLE PRECISION NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    recommendation VARCHAR(4) NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolioValue (
    portfolioValue DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolioAvailableCash (
    availableCash DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolioHistory (
    date DATE NOT NULL,
    portfolioValue DOUBLE PRECISION NOT NULL,
    availableCash DOUBLE PRECISION NOT NULL
);