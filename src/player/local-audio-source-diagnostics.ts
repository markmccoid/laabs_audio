const decodeUriComponentSafely = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const describeLocalAudioSourceUri = (uri: string) => {
  const withoutQueryOrFragment = uri.split(/[?#]/, 1)[0] ?? uri;
  const nativePath = decodeUriComponentSafely(
    withoutQueryOrFragment.replace(/^file:\/\//, ""),
  );
  const filename = nativePath.split("/").at(-1) || null;
  const dotIndex = filename?.lastIndexOf(".") ?? -1;
  const extension =
    filename && dotIndex > 0 && dotIndex < filename.length - 1
      ? filename.slice(dotIndex + 1).toLowerCase()
      : null;

  return {
    uri,
    nativePath,
    filename,
    extension,
  };
};
