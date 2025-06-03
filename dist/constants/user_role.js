"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRoleTypeEnum = void 0;
var UserRoleTypeEnum;
(function (UserRoleTypeEnum) {
    UserRoleTypeEnum["VIIS_ROOT_USER"] = "VIIS_ROOT_USER";
    UserRoleTypeEnum["ROOT_USER"] = "System User";
    UserRoleTypeEnum["TENANT_SUPER_ADMIN"] = "TENANT_SUPER_ADMIN";
    UserRoleTypeEnum["TENANT_ADMIN"] = "TENANT_ADMIN";
    UserRoleTypeEnum["TENANT_USER"] = "TENANT_USER";
    UserRoleTypeEnum["TENANT_CUSTOM_ROLE"] = "TENANT_CUSTOM_ROLE";
    UserRoleTypeEnum["CUSTOMER_USER"] = "Viis IoT User";
})(UserRoleTypeEnum || (exports.UserRoleTypeEnum = UserRoleTypeEnum = {}));
exports.default = UserRoleTypeEnum;
