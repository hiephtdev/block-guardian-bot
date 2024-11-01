// models/Tracking.js
const mongoose = require('mongoose');

const trackingSchema = new mongoose.Schema({
    chatId: { type: String, required: true },
    wallet: { type: String, required: true },
    name: { type: String, required: true }
});

module.exports = mongoose.model('Tracking', trackingSchema);
