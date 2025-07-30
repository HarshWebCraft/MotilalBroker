const express = require("express");
const router = express.Router();

// Place Order API
router.post("/place-order", require("./PlaceOrder"));

// Modify Order API
router.post("/modify-order", require("./ModifyOrder"));

// Cancel Order API
router.post("/cancel-order", require("./CancelOrder"));

// Exit Trade API
router.post("/exit-Trade", require("./ExitTrade"));

// Order Book API
router.post("/order-book", require("./OrderBook"));

// Trade Book API
router.post("/trade-book", require("./TradeBook"));

// Order Detail API
router.post("/order-detail", require("./OrderDetails"));

// Trade Detail API
router.post("/trade-detail", require("./TradeDetails"));

// Position Size Detail API
router.post("/positionsize-order", require("./PositionSizeTrade"));

module.exports = router;
