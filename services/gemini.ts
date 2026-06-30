import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Disable thinking to avoid $3.50/1M thinking-token charges
const GENERATION_CONFIG = {
  thinkingConfig: { thinkingBudget: 0 },
};

// Compress image to max 800×800px at 80% quality before sending
export async function compressImage(base64OrUri: string): Promise<string> {
  if (Platform.OS === 'web') return base64OrUri;
  try {
    const uri = base64OrUri.startsWith('data:') || base64OrUri.startsWith('http')
      ? base64OrUri
      : `data:image/jpeg;base64,${base64OrUri}`;
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 800, height: 800 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return result.base64 ?? base64OrUri;
  } catch {
    return base64OrUri;
  }
}

// Text-only call
export const callGemini = async (prompt: string): Promise<string> => {
  console.log('[Gemini] Prompt Länge:', prompt.length, '| Bild vorhanden: false');

  if (Platform.OS === 'web') {
    const { geminiModel } = await import('@/lib/firebase');
    const result = await geminiModel.generateContent(prompt);
    return result.response.text();
  }

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: GENERATION_CONFIG,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
};

// Image + text call — compresses image before sending
export const callGeminiWithImage = async (
  base64: string,
  prompt: string,
): Promise<string> => {
  console.log('[Gemini] Prompt Länge:', prompt.length, '| Bild vorhanden: true | Base64 Länge:', base64.length);

  // Strip data URL prefix + compress
  const stripped = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
  const compressed = await compressImage(stripped);
  const pureBase64 = compressed.includes('base64,') ? compressed.split('base64,')[1] : compressed;

  console.log('[Gemini] Komprimierte Base64 Länge:', pureBase64.length);

  if (Platform.OS === 'web') {
    const { geminiModel } = await import('@/lib/firebase');
    const result = await geminiModel.generateContent([
      { inlineData: { mimeType: 'image/jpeg', data: pureBase64 } },
      { text: prompt },
    ]);
    return result.response.text();
  }

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: pureBase64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: GENERATION_CONFIG,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
};

// Audio file upload + transcription call via Gemini File API
export const callGeminiWithAudio = async (uri: string, prompt: string): Promise<string> => {
  if (Platform.OS === 'web') throw new Error('Audio-Analyse nicht auf Web verfügbar');
  const FileSystem = await import('expo-file-system/legacy');
  const mimeType = uri.toLowerCase().endsWith('.3gp') ? 'audio/3gpp' : 'audio/mp4';

  const upload = await FileSystem.uploadAsync(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key=${GEMINI_KEY}`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': mimeType,
      },
    },
  );
  if (upload.status !== 200) throw new Error(`Audio-Upload fehlgeschlagen: HTTP ${upload.status}`);
  const { file } = JSON.parse(upload.body);

  const audioResp = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { file_data: { mime_type: mimeType, file_uri: file.uri } },
        { text: prompt },
      ]}],
      generationConfig: GENERATION_CONFIG,
    }),
  });
  if (!audioResp.ok) {
    const err = await audioResp.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${audioResp.status}`);
  }
  const audioData = await audioResp.json();
  return audioData.candidates[0].content.parts[0].text;
};
