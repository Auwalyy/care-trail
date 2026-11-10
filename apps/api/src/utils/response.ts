import type { Response } from 'express';
import type { ApiList, ApiSuccess } from '@caretrail/shared-types';

export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { data, meta: { requestId: res.locals.requestId as string } };
  res.status(status).json(body);
}

export function sendList<T>(
  res: Response,
  items: T[],
  pagination: { page: number; pageSize: number; total: number },
): void {
  const body: ApiList<T> = {
    data: items,
    meta: {
      requestId: res.locals.requestId as string,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: pagination.total,
      totalPages: Math.max(1, Math.ceil(pagination.total / pagination.pageSize)),
    },
  };
  res.status(200).json(body);
}
