"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUrl = parseUrl;
function parseUrl(url) {
    return url.split('?')[0];
}
