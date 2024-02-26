-- Create a table named 'portfolio'
CREATE TABLE IF NOT EXISTS portfolio (
    ticker VARCHAR(4) PRIMARY KEY,
    price DOUBLE PRECISION NOT NULL,
    quantity DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolioValue {
    portfolioValue DOUBLE PRECISION NOT NULL;
}

CREATE TABLE IF NOT EXISTS portfolioAvailableCash {
    availableCash DOUBLE PRECISION NOT NULL;
}

CREATE TABLE IF NOT EXISTS portfolioHistory {
    date DATE NOT NULL,
    portfolioValue DOUBLE PRECISION NOT NULL,
    availableCash DOUBLE PRECISION NOT NULL
}