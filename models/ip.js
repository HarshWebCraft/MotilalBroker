const mongoose = require("mongoose");

const IP = mongoose.model(
  "IP",
  new mongoose.Schema({
    XalgoID: { type: String, required: true, index: true },
    Ips: [{ ip: String }],
  }),
);

module.exports = IP;
