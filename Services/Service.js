const express = require('express');
const IndexLTP = require('./IndexLTP.js');
const router = express.Router()

router.post('/get-ltp',require('./GetLTP.js'))
router.post('/getProfile', require("./getProfile.js"));
router.post('/getIndexLTP',IndexLTP)

module.exports = router;
