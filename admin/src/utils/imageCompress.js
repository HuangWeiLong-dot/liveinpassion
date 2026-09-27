// 浏览器端图片压缩：长边 1920，JPEG q0.8
import imageCompression from 'browser-image-compression';

export async function compressImage(file) {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.8,
  };
  try {
    return await imageCompression(file, options);
  } catch (err) {
    console.warn('Image compression failed, using original:', err);
    return null;
  }
}
