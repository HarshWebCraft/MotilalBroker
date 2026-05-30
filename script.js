/**
 * Kotak Scrip Master Cron Job
 * Downloads ALL exchanges
 * Saves normalized JSON files
 */

const axios = require("axios");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const dayjs = require("dayjs");

const forwardWebhookText = require("./forwardWebhookText");

const TIMEZONE = "Asia/Kolkata";

const DATA_DIR = path.join(__dirname, "./data");

// ---------------------------------------------------
// ALL EXCHANGES
// ---------------------------------------------------

const EXCHANGES = [
  "nse_cm",
  "bse_cm",
  "nse_fo",
  "bse_fo",
  "mcx_fo",
  "ncdex_fo",
  "cds_fo",
];

// ---------------------------------------------------
// FILE NAMES
// ---------------------------------------------------

const FILE_NAME_MAP = {
  nse_cm: "nse_cm",
  bse_cm: "bse_cm",
  nse_fo: "nse_fo",
  bse_fo: "bse_fo",
  mcx_fo: "mcx_fo",
  ncdex_fo: "ncdex_fo",
  cds_fo: "CDS",
};

// ---------------------------------------------------
// CREATE DATA DIR
// ---------------------------------------------------

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true,
  });
}

// ---------------------------------------------------
// DOWNLOAD CSV
// ---------------------------------------------------

async function downloadCSV(date, exchange) {
  const url = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${date}/transformed/${exchange}.csv`;

  return axios.get(url, {
    responseType: "stream",
    timeout: 30000,
  });
}

// ---------------------------------------------------
// NORMALIZE ROW
// ---------------------------------------------------

function normalizeRow(row, exchange) {
  let exchangeName = FILE_NAME_MAP[exchange];

  // ---------------------------------------------------
  // TRADING SYMBOL
  // ---------------------------------------------------

  const tradingsymbol =
    row.pTrdSymbol?.trim() ||
    row.pScripRefKey?.trim() ||
    row.pSymbolName?.trim() ||
    row.pInstrumentInfo?.trim();

  if (!tradingsymbol) {
    return null;
  }

  // ---------------------------------------------------
  // NAME
  // ---------------------------------------------------

  const name = row.pSymbol?.trim() || row.pSymbolName?.trim() || tradingsymbol;

  const record = {
    exchange: exchangeName,
    name,
    tradingsymbol,
  };

  // ---------------------------------------------------
  // TOKEN
  // ---------------------------------------------------

  if (row.pScripCode) {
    record.token = Number(row.pScripCode);
  }

  // ---------------------------------------------------
  // LOT SIZE
  // ---------------------------------------------------

  if (row.iLotSize) {
    record.lot_size = Number(row.iLotSize);
  }

  // ---------------------------------------------------
  // OPTION TYPE
  // ---------------------------------------------------

  if (row.pOptionType) {
    record.instrument_type = row.pOptionType.trim();
  }

  // ---------------------------------------------------
  // STRIKE
  // ---------------------------------------------------

  if (row.dStrikePrice && row.dStrikePrice !== "") {
    record.strike = Number(row.dStrikePrice);
  }

  // ---------------------------------------------------
  // EXPIRY
  // ---------------------------------------------------

  if (row.lExpiryDate && row.lExpiryDate !== "0") {
    record.expiry = dayjs
      .unix(Number(row.lExpiryDate))
      .format("DDMMMYYYY")
      .toUpperCase();
  }

  // ---------------------------------------------------
  // FREEZE QTY
  // ---------------------------------------------------

  if (row.lFreezeQty) {
    record.freeze_qty = Number(row.lFreezeQty);
  }

  // ---------------------------------------------------
  // SERIES
  // ---------------------------------------------------

  if (row.pSeries) {
    record.series = row.pSeries.trim();
  }

  return record;
}

// ---------------------------------------------------
// PROCESS EXCHANGE
// ---------------------------------------------------

async function processExchange(exchange) {
  console.log(`\n🔄 Processing ${exchange}`);

  const datesToTry = [
    dayjs().format("YYYY-MM-DD"),
    dayjs().subtract(1, "day").format("YYYY-MM-DD"),
  ];

  let stream = null;

  for (const date of datesToTry) {
    try {
      console.log(`🔍 Trying ${date}`);

      const res = await downloadCSV(date, exchange);

      stream = res.data;

      console.log(`✅ CSV Found (${date})`);

      break;
    } catch (err) {
      console.log(`❌ Not available (${date})`);
    }
  }

  if (!stream) {
    console.log(`⚠️ Skipping ${exchange}`);
    return;
  }

  const records = [];

  await new Promise((resolve, reject) => {
    stream
      .pipe(csv())
      .on("data", (row) => {
        try {
          const record = normalizeRow(row, exchange);

          if (record) {
            records.push(record);
          }
        } catch (err) {}
      })
      .on("end", resolve)
      .on("error", reject);
  });

  // ---------------------------------------------------
  // REMOVE DUPLICATES
  // ---------------------------------------------------

  const unique = [];

  const seen = new Set();

  for (const item of records) {
    const key = `${item.exchange}_${item.tradingsymbol}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  // ---------------------------------------------------
  // SAVE FILE
  // ---------------------------------------------------

  const fileName = FILE_NAME_MAP[exchange];

  const filePath = path.join(DATA_DIR, `${fileName}.json`);

  fs.writeFileSync(filePath, JSON.stringify(unique, null, 2), "utf8");

  console.log(`📁 Saved ${unique.length} → ${fileName}.json`);
}

// ---------------------------------------------------
// MAIN JOB
// ---------------------------------------------------

async function runScripMasterJob() {
  console.log("\n⏰ Kotak Master Script Job START\n");

  for (const exchange of EXCHANGES) {
    try {
      await processExchange(exchange);
    } catch (err) {
      console.log(`❌ ${exchange} failed -> ${err.message}`);
    }
  }

  console.log("\n✅ All Exchanges Completed\n");

  await forwardWebhookText(`Kotak Master Script Updated ✅`);
}

// ---------------------------------------------------
// CRON
// ---------------------------------------------------

cron.schedule(
  "0 6 * * *",
  async () => {
    try {
      await runScripMasterJob();
    } catch (err) {
      console.log("❌ Cron Error:", err.message);
    }
  },
  {
    timezone: TIMEZONE,
  },
);

// ---------------------------------------------------
// OPTIONAL STARTUP RUN
// ---------------------------------------------------

// runScripMasterJob().catch(console.error);

module.exports = runScripMasterJob;
