let _uri = '';
let _base64 = '';

export const capturedPhoto = {
  set(uri: string, base64: string) {
    _uri = uri;
    _base64 = base64;
  },
  get() {
    return { uri: _uri, base64: _base64 };
  },
  clear() {
    _uri = '';
    _base64 = '';
  },
};
