import { NodeMessageInFlow } from 'node-red';

export interface ExtendedNodeMessage extends NodeMessageInFlow {
    req?: {
        method: string;
        url: string;
        query: any;
        payload: any;
    };
}

export interface Pagination {
    totalElements: number;
    totalPages: number;
    pageSize: number;
    pageNumber: number;
    order_by: string;
}