import { Database } from 'lucide-react';
import { ConnectCTA } from '@/components/ConnectCTA';

interface TableEmptyStateProps {
  searchTerm: string;
}

export function TableEmptyState({ searchTerm }: TableEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-4 text-center">
      <Database className="h-10 w-10 text-gray-400 dark:text-neutral-600 mb-3" />
      <p className="text-sm text-gray-600 dark:text-neutral-400 font-medium">
        {searchTerm ? 'No tables found' : 'No tables yet'}
      </p>
      {!searchTerm && (
        <p className="text-xs text-gray-500 dark:text-neutral-400 font-medium mt-1 mx-10">
          <ConnectCTA fallback="Create your first table to get started" />
        </p>
      )}
    </div>
  );
}
