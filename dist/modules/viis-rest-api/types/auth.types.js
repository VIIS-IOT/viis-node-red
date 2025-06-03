"use strict";
/**
 * @fileoverview Authentication types and interfaces
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasswordHashType = void 0;
/**
 * Password hash types
 */
var PasswordHashType;
(function (PasswordHashType) {
    PasswordHashType["BCRYPT"] = "bcrypt";
    PasswordHashType["MD5"] = "md5";
    PasswordHashType["SHA256"] = "sha256";
    PasswordHashType["PLAIN"] = "plain";
})(PasswordHashType || (exports.PasswordHashType = PasswordHashType = {}));
