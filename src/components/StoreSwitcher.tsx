import { useState } from 'react';
import { Check, ChevronsUpDown, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Badge } from './ui/badge';
import { CreateStoreDialog } from './CreateStoreDialog';

interface StoreSwitcherProps {
  className?: string;
  collapsed?: boolean;
}

export function StoreSwitcher({ className, collapsed = false }: StoreSwitcherProps) {
  const { currentStore, stores, switchStore } = useAuth();
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // If no stores at all, don't show anything
  if (stores.length === 0) {
    return null;
  }

  // Only users who are owners of at least one store can create new stores
  const canCreateStore = stores.some(store => store.role === 'owner');

  const handleStoreSwitch = (storeId: string) => {
    if (storeId !== currentStore?.id) {
      switchStore(storeId);
      setOpen(false);
      // Refresh the page to reload data for the new store
      window.location.reload();
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Seleccionar tienda"
          className={cn(
            'justify-between h-10 bg-background hover:bg-accent transition-all duration-200 cursor-pointer',
            collapsed ? 'w-10 px-0' : 'w-full px-3',
            className
          )}
        >
          {collapsed ? (
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center shadow-sm">
              <span className="text-primary-foreground font-bold text-xs">O</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center shadow-sm flex-shrink-0">
                  <span className="text-primary-foreground font-bold text-xs">O</span>
                </div>
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-sm font-medium truncate max-w-[180px]">
                    {currentStore?.name || 'Seleccionar tienda'}
                  </span>
                  {currentStore?.role && (
                    <span className="text-xs text-muted-foreground capitalize">
                      {currentStore.role === 'owner' ? 'Propietario' :
                       currentStore.role === 'admin' ? 'Administrador' :
                       currentStore.role}
                    </span>
                  )}
                </div>
              </div>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={collapsed ? 'end' : 'start'}
        className="w-[280px]"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Tus Tiendas
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[300px] overflow-y-auto">
          {stores.map((store) => (
            <DropdownMenuItem
              key={store.id}
              onClick={() => handleStoreSwitch(store.id)}
              className="cursor-pointer flex items-center gap-2 py-2.5"
            >
              <Check
                className={cn(
                  'h-4 w-4 flex-shrink-0',
                  currentStore?.id === store.id
                    ? 'opacity-100 text-primary'
                    : 'opacity-0'
                )}
              />
              <div className="flex flex-col flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {store.name}
                  </span>
                  {store.role === 'owner' && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20"
                    >
                      Propietario
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {store.country} • {store.currency}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
        </div>
        {/* Only show create store option for users who own at least one store */}
        {canCreateStore && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => {
                setOpen(false);
                setCreateDialogOpen(true);
              }}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              <span className="text-sm">Crear nueva tienda</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>

      <CreateStoreDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </DropdownMenu>
  );
}
