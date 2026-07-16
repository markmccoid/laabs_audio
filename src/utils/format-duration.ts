export const formatSeriesDuration = (seconds: number | null | undefined) => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return null;

  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `Series duration ${hours} h ${minutes} m`;
};
