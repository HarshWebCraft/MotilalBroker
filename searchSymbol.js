const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const ALLOWED_EXCHANGES = ["NSE", "BSE", "NSEFO", "BSEFO", "MCX", "CDS"];
function parseExpiry(expiry) {
  if (!expiry) return null;

  const months = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11,
  };

  const day = parseInt(expiry.slice(0, 2));
  const mon = months[expiry.slice(2, 5)];
  const year = parseInt(expiry.slice(5));

  return new Date(year, mon, day);
}

function getPriority(symbol) {
  if (/^NIFTY\d/.test(symbol)) return 1000;
  if (/^BANKNIFTY\d/.test(symbol)) return 950;
  if (/^FINNIFTY\d/.test(symbol)) return 900;
  if (/^MIDCPNIFTY\d/.test(symbol)) return 850;
  if (/^SENSEX\d/.test(symbol)) return 800;
  if (/^NIFTYNXT50\d/.test(symbol)) return 700;
  return 0;
}
module.exports = async (req, res) => {
  try {
    let { exchange, query } = req.body;

    if (!exchange || !query) {
      return res.status(400).json({
        status: false,
        message: "exchange and query are required",
      });
    }

    exchange = exchange.toUpperCase();

    const exchangeMap = {
      NSEFO: "nse_fo",
      BSEFO: "bse_fo",
      MCX: "mcx_fo",
      NSE: "nse_cm",
      BSE: "bse_cm",
      CDS: "cds_fo",
    };

    const fileName = exchangeMap[exchange];
    if (!fileName) {
      return res.status(400).json({
        status: false,
        message: "Invalid exchange mapping",
      });
    }
    query = query.toUpperCase().trim();

    if (!ALLOWED_EXCHANGES.includes(exchange)) {
      return res.status(400).json({
        status: false,
        message: "Invalid exchange",
      });
    }

    const filePath = path.join(DATA_DIR, `${fileName}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        status: false,
        message: "Exchange data not found",
      });
    }

    const symbols = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const queryParts = query.toUpperCase().split(/\s+/).filter(Boolean);

    const result = symbols
      .map((s) => {
        if (!s.tradingsymbol) return null;

        const symbol = s.tradingsymbol.toUpperCase();
        let score = 0;

        for (const part of queryParts) {
          if (symbol.startsWith(part)) score += 100;
          else if (String(s.strike) === part) score += 90;
          else if (String(s.strike).includes(part)) score += 70;
          else if (symbol.includes(part)) score += 50;
          else return null;
        }

        score += getPriority(symbol);

        return {
          ...s,
          score,
          display: `${s.tradingsymbol} - ${s.expiry || ""} - ${s.strike || ""}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        // 1. Higher score first
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        // 2. Nearest expiry first
        const da = parseExpiry(a.expiry);
        const db = parseExpiry(b.expiry);

        if (da && db && da.getTime() !== db.getTime()) {
          return da - db;
        }

        // 3. CE before PE
        const aPE = a.tradingsymbol.endsWith("PE");
        const bPE = b.tradingsymbol.endsWith("PE");

        if (aPE !== bPE) {
          return aPE ? 1 : -1;
        }

        // 4. fallback
        return a.tradingsymbol.localeCompare(b.tradingsymbol);
      })
      .slice(0, 50);

    return res.json({
      status: true,
      count: result.length,
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};
