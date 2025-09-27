// const WebSocket = require("ws");
// const getHeaders = require("../GetHeader");

// let ws;
// ws = new WebSocket("wss://openapi.motilaloswal.com/ws");

// let isConnected = false;

// function connectWebSocket() {
//   if (isConnected) return;

//   ws = new WebSocket("wss://openapi.motilaloswal.com/ws");

//   ws.on("open", () => {
//     console.log("✅ WebSocket connected");

//     // Send authentication payload
//     ws.send(
//       JSON.stringify({
//         MessageType: "Authenticate",
//         ...getHeaders,
//       })
//     );
//   });

//   ws.on("message", (data) => {
//     try {
//       const parsed = JSON.parse(data);
//       console.log("📩 Received:", parsed);
//     } catch (err) {
//       console.log("📩 Raw Message:", data);
//     }
//   });

//   ws.on("close", () => {
//     console.log("❌ WebSocket closed");
//     isConnected = false;
//     setTimeout(connectWebSocket, 3000);
//   });

//   ws.on("error", (err) => {
//     console.error("⚠️ WebSocket error:", err);
//   });

//   isConnected = true;
// }

// // connectWebSocket();

// const register = (req, res) => {
//   const { exchange, type, scripCode } = req.body;

//   if (ws) {
//     ws.send(
//       JSON.stringify({
//         MessageType: "Register",
//         Exchange: exchange,
//         ExchangeType: type,
//         ScripCode: scripCode,
//       })
//     );
//     res.send({ status: "Scrip registered" });
//   } else {
//     res.status(500).send({ error: "WebSocket not connected" });
//   }
// };

// module.exports = register;
