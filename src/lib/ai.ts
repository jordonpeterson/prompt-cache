import type { AIAnalysisResult, SightingType } from '@/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export async function analyzePhoto(base64Image: string): Promise<AIAnalysisResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-photo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ image: base64Image }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI analysis failed: ${err}`);
  }

  const data = await res.json();

  return {
    species: data.species ?? 'Unknown',
    confidence: data.confidence ?? 0,
    alternatives: data.alternatives ?? [],
    sightingType: (data.sightingType ?? 'LiveAnimal') as SightingType,
    count: data.count ?? 1,
    sex: data.sex,
    notes: data.notes,
  };
}

export function compressImage(dataUrl: string, maxSize: number = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = (height / width) * maxSize;
          width = maxSize;
        } else {
          width = (width / height) * maxSize;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl); // Fall back to original if canvas unavailable
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = dataUrl;
  });
}
