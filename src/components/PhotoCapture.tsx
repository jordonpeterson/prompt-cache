import { useRef, useState } from 'react';
import { extractExif } from '@/lib/exif';
import type { ExifData } from '@/lib/exif';

interface PhotoCaptureProps {
  onPhotoTaken: (file: File, dataUrl: string, exif: ExifData) => void;
  onCancel: () => void;
}

export default function PhotoCapture({ onPhotoTaken, onCancel }: PhotoCaptureProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const handleFile = async (file: File) => {
    setProcessing(true);
    try {
      const exif = await extractExif(file);
      const dataUrl = await readFileAsDataUrl(file);
      onPhotoTaken(file, dataUrl, exif);
    } catch {
      // If EXIF extraction fails, still proceed with photo
      const dataUrl = await readFileAsDataUrl(file);
      onPhotoTaken(file, dataUrl, {});
    } finally {
      setProcessing(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="absolute inset-0 z-50 bg-gray-900 flex flex-col items-center justify-center gap-6 p-6">
      <h2 className="text-2xl font-bold text-white">Add Photo</h2>
      <p className="text-gray-400 text-center">
        Take a photo or choose from your gallery. Location, time, and weather will be auto-filled.
      </p>

      {processing ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-green-400">Processing photo...</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 w-full max-w-xs">
          {/* Camera capture */}
          <button
            onClick={() => fileInput.current?.click()}
            className="w-full py-4 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl text-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Take Photo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleInputChange}
            className="hidden"
          />

          {/* Gallery picker */}
          <button
            onClick={() => galleryInput.current?.click()}
            className="w-full py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl text-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            Choose from Gallery
          </button>
          <input
            ref={galleryInput}
            type="file"
            accept="image/*"
            onChange={handleInputChange}
            className="hidden"
          />

          <button
            onClick={onCancel}
            className="w-full py-3 text-gray-400 hover:text-white transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
