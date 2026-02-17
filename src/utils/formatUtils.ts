import { Dimensions } from "react-native";

export const formatBytes = (bytes: number) => {
  let finalBytes = "";
  if (bytes >= 1073741824) {
    finalBytes = (bytes / 1073741824).toFixed(2) + " GB";
  } else if (bytes >= 1048576) {
    finalBytes = (bytes / 1048576).toFixed(2) + " MB";
  } else if (bytes >= 1024) {
    finalBytes = (bytes / 1024).toFixed(2) + " KB";
  } else if (bytes > 1) {
    finalBytes = bytes + " bytes";
  } else if (bytes == 1) {
    finalBytes = bytes + " byte";
  } else {
    finalBytes = "0 bytes";
  }
  return finalBytes;
};

export const formatSeconds = (
  secondsIn: number,
  type?: "minimal" | "verbose" | "verbose_no_seconds" | "compact" | "minimal-no-seconds",
  showHours?: boolean,
  showSeconds?: boolean,
) => {
  type = type || "minimal";
  showHours = showHours ?? true;
  showSeconds = showSeconds ?? true;
  // if (!secondsIn) return 0;
  const d = Number(secondsIn);
  if (isNaN(d)) return undefined;
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = Math.floor((d % 3600) % 60);

  if (type === "minimal") {
    const hours = `${h > 0 ? h + ":" : "00:"}`;
    const seconds = `${s.toString().padStart(2, "0")}`;
    const minutes = `${m > 0 ? m.toString().padStart(2, "0") : "00"}`;
    return `${showHours === true ? hours : ""}${minutes}${showSeconds ? ":" + seconds : ""}`;
  }

  if (type === "minimal-no-seconds") {
    const hours = `${h > 0 ? h + "h " : "0h "}`;
    // const seconds = `${s.toString().padStart(2, "0")}`;
    const minutes = `${m > 0 ? m.toString().padStart(2, "0") : "00"}`;
    return `${showHours === true ? hours : ""}${minutes}m`;
  }
  if (type === "compact") {
    // Strip out unused time periods
    if (h > 0) {
      // If there are hours, show h:mm:ss format
      const hours = h.toString();
      const minutes = m.toString().padStart(2, "0");
      const seconds = s.toString().padStart(2, "0");
      return `${hours}:${minutes}${showSeconds ? ":" + seconds : ""}`;
    } else if (m > 0) {
      // If there are minutes but no hours, show mm:ss format
      const minutes = m.toString().padStart(2, "0");
      const seconds = s.toString().padStart(2, "0");
      return `${minutes}${showSeconds ? ":" + seconds : ""}`;
    } else {
      // If only seconds, show just seconds
      return showSeconds ? `00:${s.toString().padStart(2, "0")}` : "0";
    }
  }

  let hDisplay = "";
  let mDisplay = "";
  let sDisplay = "";
  if (type === "verbose") {
    hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
    mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
    sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
  } else if (type === "verbose_no_seconds") {
    hDisplay = h > 0 ? h + (h == 1 ? " hr " : " hrs ") : "";
    mDisplay = m > 0 ? m + (m == 1 ? " min " : " min ") : "";
  }
  if (!showHours) {
    return mDisplay + sDisplay;
  }
  if (!showSeconds) {
    return hDisplay + mDisplay;
  }
  return hDisplay + mDisplay + sDisplay;
};

// Takes an End Date and Start Date and return minutes and seconds
// most usefull will be minutesInt and secondsInt as they take
// the total milliseconds and give you the minutes and seconds
// the minutesBetween will be in the form of a float 6.05
// secondsBetween will be the total seconds 365
export const timeBetween = (endDate: Date, startDate: Date) => {
  const msBetween = endDate.valueOf() - startDate.valueOf();
  const secondsBetween = Math.floor(msBetween / 1000);
  const minutesBetween = secondsBetween / 60;
  const secondsLeft = Math.floor((minutesBetween - Math.floor(minutesBetween)) * 60);
  return {
    secondsBetween,
    minutesBetween,
    minutesInt: Math.floor(minutesBetween),
    secondsInt: secondsLeft,
  };
};

// Calculate image dimensions based on screen width with 20px margin on each side
export const getImageDimensions = () => {
  const screenWidth = Dimensions.get("window").width;
  const margin = 30 * 2; // 20px on each side
  const imageSize = screenWidth - margin;
  return {
    width: imageSize,
    height: imageSize,
    borderRadius: 12,
  };
};

// Removes emojis, symbols, punctuation, spaces — keeps only A–Z, a–z, 0–9
export const stripSpecial = (str: string) => {
  return str.replace(/[^a-zA-Z0-9]/g, "");
};
