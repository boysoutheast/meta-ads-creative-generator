'use client'
import { useDropzone } from 'react-dropzone'
import { Upload, X, FileImage, FileVideo } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface Props {
  file: File | null
  onChange: (f: File | null) => void
  accept?: 'image' | 'video' | 'both'
  maxSizeMB?: number
  hint?: string
}

const ACCEPT_MAP = {
  image: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
  video: { 'video/*': ['.mp4', '.mov', '.webm'] },
  both: {
    'image/*': ['.jpg', '.jpeg', '.png', '.webp'],
    'video/*': ['.mp4', '.mov', '.webm'],
  },
} as const

export function Dropzone({ file, onChange, accept = 'both', maxSizeMB = 50, hint }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT_MAP[accept],
    multiple: false,
    maxSize: maxSizeMB * 1024 * 1024,
    onDrop: (accepted) => {
      if (accepted[0]) onChange(accepted[0])
    },
  })

  if (file) {
    const isImage = file.type.startsWith('image/')
    const url = URL.createObjectURL(file)
    return (
      <div className="relative rounded-xl border bg-muted/30 p-4">
        <div className="flex items-center gap-4">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} className="h-20 w-20 rounded-lg object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-secondary">
              <FileVideo className="h-8 w-8" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isImage ? <FileImage className="h-4 w-4 shrink-0" /> : <FileVideo className="h-4 w-4 shrink-0" />}
              <p className="truncate text-sm font-medium">{file.name}</p>
            </div>
            <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Remove file">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
        isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/60 hover:bg-accent/40'
      )}
    >
      <input {...getInputProps()} />
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Upload className="h-6 w-6" />
      </div>
      <p className="font-medium">{isDragActive ? 'Drop file di sini…' : 'Drag & drop atau klik untuk upload'}</p>
      <p className="text-xs text-muted-foreground">
        {accept === 'image' && 'PNG, JPG, WEBP'}
        {accept === 'video' && 'MP4, MOV, WEBM'}
        {accept === 'both' && 'PNG, JPG, WEBP, MP4, MOV, WEBM'}
        {' · max '}
        {maxSizeMB}MB
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
