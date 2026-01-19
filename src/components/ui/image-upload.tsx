import * as React from 'react';
import { useState, useRef } from 'react';
import { Upload, X, Link as LinkIcon, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { cn } from '@/lib/utils';
import {
  uploadAvatar,
  uploadProductImage,
  uploadMerchandiseImage,
  validateImageFile,
  isExternalUrl
} from '@/services/upload.service';

export interface ImageUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  type: 'avatar' | 'product' | 'merchandise';
  entityId?: string; // Required for product/merchandise
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  showUrlOption?: boolean; // Allow external URL input
}

export function ImageUpload({
  value,
  onChange,
  type,
  entityId,
  className,
  disabled = false,
  placeholder = 'Arrastra una imagen o haz clic para subir',
  showUrlOption = true
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    setError(null);

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Archivo inválido');
      return;
    }

    setIsUploading(true);

    try {
      let result;

      switch (type) {
        case 'avatar':
          result = await uploadAvatar(file);
          break;
        case 'product':
          if (!entityId) {
            setError('Se requiere ID del producto');
            return;
          }
          result = await uploadProductImage(entityId, file);
          break;
        case 'merchandise':
          if (!entityId) {
            setError('Se requiere ID del envío');
            return;
          }
          result = await uploadMerchandiseImage(entityId, file);
          break;
      }

      if (result.success && result.url) {
        onChange(result.url);
      } else {
        setError(result.error || 'Error al subir imagen');
      }
    } catch (err: any) {
      logger.error('Upload error:', err);
      setError(err.response?.data?.error || 'Error al subir imagen');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (disabled || isUploading) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleClick = () => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      if (!isExternalUrl(urlInput)) {
        setError('Por favor ingresa una URL válida (http:// o https://)');
        return;
      }
      onChange(urlInput.trim());
      setUrlInput('');
      setError(null);
    }
  };

  const handleRemove = () => {
    onChange(null);
    setError(null);
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Mode Toggle */}
      {showUrlOption && !value && (
        <div className="flex gap-2 mb-2">
          <Button
            type="button"
            variant={mode === 'upload' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('upload')}
            disabled={disabled}
          >
            <Upload className="h-4 w-4 mr-1" />
            Subir
          </Button>
          <Button
            type="button"
            variant={mode === 'url' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('url')}
            disabled={disabled}
          >
            <LinkIcon className="h-4 w-4 mr-1" />
            URL
          </Button>
        </div>
      )}

      {/* Preview */}
      {value && (
        <div className="relative inline-block">
          <img
            src={value}
            alt="Preview"
            className="h-32 w-32 object-cover rounded-lg border border-border"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/placeholder-image.png';
            }}
          />
          {!disabled && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute -top-2 -right-2 h-6 w-6"
              onClick={handleRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Upload Area */}
      {!value && mode === 'upload' && (
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
            isDragging && 'border-primary bg-primary/5',
            !isDragging && 'border-muted-foreground/25 hover:border-primary/50',
            (disabled || isUploading) && 'cursor-not-allowed opacity-50'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileInputChange}
            disabled={disabled || isUploading}
          />

          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Subiendo...</span>
            </>
          ) : (
            <>
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground text-center">
                {placeholder}
              </span>
              <span className="text-xs text-muted-foreground">
                JPEG, PNG, WebP o GIF (máx. 5MB)
              </span>
            </>
          )}
        </div>
      )}

      {/* URL Input */}
      {!value && mode === 'url' && (
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://ejemplo.com/imagen.jpg"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleUrlSubmit();
              }
            }}
          />
          <Button
            type="button"
            onClick={handleUrlSubmit}
            disabled={disabled || !urlInput.trim()}
          >
            Usar
          </Button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}

export default ImageUpload;
