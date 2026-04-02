import exifr from 'exifr';

export interface ExifData {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  compassHeading?: number;
  dateTime?: string;
  deviceMake?: string;
  deviceModel?: string;
}

export async function extractExif(file: File | Blob): Promise<ExifData> {
  try {
    const parsed = await exifr.parse(file, {
      gps: true,
      exif: true,
      tiff: true,
      pick: [
        'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSImgDirection',
        'DateTimeOriginal', 'Make', 'Model',
      ],
    });

    if (!parsed) return {};

    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      altitude: parsed.GPSAltitude,
      compassHeading: parsed.GPSImgDirection,
      dateTime: parsed.DateTimeOriginal
        ? new Date(parsed.DateTimeOriginal).toISOString()
        : undefined,
      deviceMake: parsed.Make,
      deviceModel: parsed.Model,
    };
  } catch {
    return {};
  }
}
