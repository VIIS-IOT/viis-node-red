// Offline test boundary. Fail closed rather than contact the production database.
export const AppDataSource = {isInitialized:true,initialize:async()=>{},getRepository:()=>{throw new Error('Real database access is forbidden in offline compatibility tests')}};
export const createDataSource=async()=>AppDataSource;
export const releaseDataSource=async()=>{};
export const DataSourceManager={acquire:createDataSource,release:releaseDataSource};
