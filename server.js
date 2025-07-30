const express = require("express");
const app = express();
const Order = require("./Order/Order");
const Services = require("./Services/Service");
const bodyParser = require("body-parser");
const Websocket = require("./WebSocket/websocket");
const mongoose = require("mongoose");

require("dotenv").config();
app.use(bodyParser.json());

mongoose
  .connect(`${process.env.MongoUrl}`)
  .then(() => {
    console.log("Mongoose Connected");
  })
  .catch((e) => {
    console.log("Error is " + e);
  });

app.use(express.json());

app.get("/health", (req, res) => res.json("Running"));

app.post("/login", require("./auth/login"));

app.use(Order);

app.use(Services);

// app.use(Websocket)

// Start the server
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
