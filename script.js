/**
 * Kotak Scrip Master Cron Job
 * Runs daily @ 6:00 AM IST
 * Downloads all exchange CSVs
 * Stores PURE JSON files (no JS syntax)
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

const EXCHANGES = ["nse_fo", "bse_fo", "mcx_fo"];

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---------- Helpers ----------

async function downloadCSV(date, exchange) {
  const url = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${date}/transformed/${exchange}.csv`;
  return axios.get(url, { responseType: "stream", timeout: 20000 });
}

// ---------- Core Logic ----------

async function processExchange(exchange) {
  console.log(`🔄 Processing ${exchange}`);

  const datesToTry = [
    dayjs().format("YYYY-MM-DD"),
    dayjs().subtract(1, "day").format("YYYY-MM-DD"),
  ];

  let stream = null;

  for (const date of datesToTry) {
    try {
      console.log(`🔍 Trying date ${date} for ${exchange}`);
      const res = await downloadCSV(date, exchange);
      stream = res.data;
      console.log(`✅ ${exchange} CSV found for ${date}`);
      break;
    } catch (err) {
      console.log(`❌ ${exchange} not available for ${date}`);
    }
  }

  if (!stream) {
    console.log(`⚠️ Skipping ${exchange}, CSV unavailable`);
    return;
  }

  const records = [];

  await new Promise((resolve, reject) => {
    stream
      .pipe(csv())
      .on("data", (row) => {
        let pSymbol = null;
        let pTrdSymbol = null;

        if (exchange === "mcx_fo") {
          // MCX specific
          pSymbol = row.pSymbol?.trim(); // GOLD / SILVER / etc
          pTrdSymbol =
            row.pTrdSymbol?.trim() ||
            row.pSymbolName?.trim() ||
            row.pInstrumentInfo?.trim(); // fallback
        } else {
          // NSE / BSE
          pSymbol = row.pSymbol?.trim();
          pTrdSymbol = row.pScripRefKey?.trim();
        }

        if (!pSymbol || !pTrdSymbol) return;

        const record = {
          pSymbol,
          pTrdSymbol,
        };

        if (row.pOptionType) record.pOptionType = row.pOptionType.trim();

        if (row.lExpiryDate) {
          record.pExpiryDate = dayjs
            .unix(Number(row.lExpiryDate))
            .format("DDMMMYYYY");
        }

        if (row.dStrikePrice && row.dStrikePrice !== "") {
          record.dStrikePrice = Number(row.dStrikePrice);
        }

        if (row.lFreezeQty) {
          record.lFreezeQty = Number(row.lFreezeQty);
        }

        records.push(record);
      })

      .on("end", resolve)
      .on("error", reject);
  });

  const filePath = path.join(DATA_DIR, `${exchange}.json`);

  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");

  console.log(`📁 Saved ${records.length} records → ${exchange}.json`);
}

async function runScripMasterJob() {
  console.log("⏰ motilal Scrip Master Job START");

  for (const exchange of EXCHANGES) {
    await processExchange(exchange);
  }

  await forwardWebhookText(`motilal Script Job Completed ✅`);
  console.log("✅ motilal Scrip Master Job DONE");
}

// ---------- CRON (6 AM IST) ----------

cron.schedule(
  // "* * * * *",
  "0 6 * * *",
  async () => {
    try {
      await runScripMasterJob();
    } catch (err) {
      console.error("❌ Cron failure:", err.message);
    }
  },
  { timezone: TIMEZONE },
);

// ---------- OPTIONAL: run once on startup ----------
// runScripMasterJob().catch(console.error);
module.exports = runScripMasterJob;
