// The Android icons are Material Symbols' XML vectors, which Metro serves as assets.
const {getDefaultConfig} = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('xml')) config.resolver.assetExts.push('xml');

module.exports = config;
