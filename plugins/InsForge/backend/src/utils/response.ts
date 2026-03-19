import { Response } from 'express';

// Traditional REST response - data returned directly
// Error responses use standard HTTP status codes with error body

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  nextActions?: string;
}

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  page?: number;
  totalPages?: number;
}

// Traditional REST success response - returns data directly
export function successResponse<T>(res: Response, data: T, statusCode: number = 200) {
  return res.status(statusCode).json(data);
}

// Traditional REST error response
export function errorResponse(
  res: Response,
  error: string,
  message: string,
  statusCode: number = 500,
  nextActions?: string
) {
  const response: ErrorResponse = {
    error,
    message,
    statusCode,
    nextActions,
  };

  return res.status(statusCode).json(response);
}

// Pagination response helper - returns data with PostgREST-style pagination headers
export function paginatedResponse<T>(res: Response, data: T[], total: number, offset: number) {
  // Calculate the range for Content-Range header
  const start = offset;
  const end = Math.min(offset + data.length - 1, total - 1);

  // Set PostgREST-style pagination headers
  // Format: "Content-Range: start-end/total"
  // Example: "Content-Range: 0-9/200" for first 10 items out of 200
  res.setHeader('Content-Range', `${start}-${end}/${total}`);

  // Also set Prefer header to indicate preference was applied
  res.setHeader('Preference-Applied', 'count=exact');

  // Use 206 Partial Content when not returning all results, 200 when returning everything
  const statusCode = data.length < total ? 206 : 200;

  return res.status(statusCode).json(data);
}
