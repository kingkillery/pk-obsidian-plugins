import { useState, useMemo } from 'react';

export function usePagination<T>(data: T[], defaultPageSize = 50) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(defaultPageSize);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return data.slice(startIndex, endIndex);
  }, [data, currentPage, pageSize]);

  const totalPages = Math.ceil(data.length / pageSize);
  const startRecord = (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, data.length);

  return {
    currentPage,
    setCurrentPage,
    pageSize,
    paginatedData,
    totalPages,
    startRecord,
    endRecord,
    totalRecords: data.length,
  };
}
