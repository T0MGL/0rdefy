import { useState, useCallback, useRef, createElement } from 'react';
import { toast } from '@/hooks/use-toast';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UndoableAction<T = any> {
  id: string;
  description: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
  timestamp: number;
  data?: T;
}

interface UseUndoRedoOptions {
  maxHistorySize?: number;
  toastDuration?: number;
}

export function useUndoRedo(options: UseUndoRedoOptions = {}) {
  const { maxHistorySize = 20, toastDuration = 3000 } = options;

  const [undoStack, setUndoStack] = useState<UndoableAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoableAction[]>([]);
  const toastIdRef = useRef<string | null>(null);

  // Execute action and add to undo stack
  const executeAction = useCallback(
    async <T = any>(
      description: string,
      action: () => Promise<void> | void,
      undoFn: () => Promise<void> | void,
      redoFn?: () => Promise<void> | void,
      data?: T
    ) => {
      // Execute the action
      await action();

      // Create undoable action
      const undoableAction: UndoableAction<T> = {
        id: Date.now().toString(),
        description,
        undo: undoFn,
        redo: redoFn || action,
        timestamp: Date.now(),
        data,
      };

      // Add to undo stack
      setUndoStack((prev) => [undoableAction, ...prev].slice(0, maxHistorySize));

      // Clear redo stack when new action is executed
      setRedoStack([]);

      // Show toast with undo button
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
      }

      const toastInstance = toast({
        title: description,
        description: 'Acción completada',
        duration: toastDuration,
        action: createElement(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            onClick: async () => {
              await undo();
            },
          },
          createElement('div', { className: 'flex items-center gap-1.5' }, [
            createElement(Undo2, { key: 'icon', className: 'h-3.5 w-3.5' }),
            createElement('span', { key: 'text' }, 'Deshacer'),
          ])
        ) as any,
      });

      toastIdRef.current = toastInstance.id;
    },
    [maxHistorySize, toastDuration]
  );

  // Undo last action
  const undo = useCallback(async () => {
    if (undoStack.length === 0) {
      toast({
        title: 'No hay acciones para deshacer',
        variant: 'default',
      });
      return;
    }

    const [lastAction, ...rest] = undoStack;

    try {
      // Execute undo
      await lastAction.undo();

      // Move to redo stack
      setRedoStack((prev) => [lastAction, ...prev]);
      setUndoStack(rest);

      toast({
        title: 'Deshecho',
        description: lastAction.description,
      });
    } catch (error) {
      console.error('Error undoing action:', error);
      toast({
        title: 'Error al deshacer',
        description: 'No se pudo deshacer la acción',
        variant: 'destructive',
      });
    }
  }, [undoStack]);

  // Redo last undone action
  const redo = useCallback(async () => {
    if (redoStack.length === 0) {
      toast({
        title: 'No hay acciones para rehacer',
        variant: 'default',
      });
      return;
    }

    const [lastAction, ...rest] = redoStack;

    try {
      // Execute redo
      await lastAction.redo();

      // Move back to undo stack
      setUndoStack((prev) => [lastAction, ...prev]);
      setRedoStack(rest);

      toast({
        title: 'Rehecho',
        description: lastAction.description,
      });
    } catch (error) {
      console.error('Error redoing action:', error);
      toast({
        title: 'Error al rehacer',
        description: 'No se pudo rehacer la acción',
        variant: 'destructive',
      });
    }
  }, [redoStack]);

  // Clear all history
  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    executeAction,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoStack,
    redoStack,
    clearHistory,
  };
}
