import type { SeriesSummary } from "@/data/sqlite/series-repository";
import { sortSeries, type SeriesSortBy, type SeriesSortDirection } from "../series-sort";

const series: SeriesSummary[] = [
  {
    id: "bravo",
    libraryId: "library",
    name: "Bravo",
    bookCount: 2,
    totalDuration: null,
    createdAt: 30,
  },
  {
    id: "charlie",
    libraryId: "library",
    name: "Charlie",
    bookCount: 1,
    totalDuration: 100,
    createdAt: null,
  },
  {
    id: "alpha",
    libraryId: "library",
    name: "Alpha",
    bookCount: 3,
    totalDuration: 200,
    createdAt: 10,
  },
];

const namesFor = (sortedBy: SeriesSortBy, direction: SeriesSortDirection) =>
  sortSeries(series, sortedBy, direction).map((entry) => entry.name);

describe("sortSeries", () => {
  it("sorts every supported field in ascending and descending order", () => {
    expect(namesFor("name", "asc")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(namesFor("name", "desc")).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(namesFor("bookCount", "asc")).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(namesFor("bookCount", "desc")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(namesFor("totalDuration", "asc")).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(namesFor("totalDuration", "desc")).toEqual(["Alpha", "Charlie", "Bravo"]);
    expect(namesFor("createdAt", "asc")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(namesFor("createdAt", "desc")).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("does not mutate the source array", () => {
    const originalOrder = series.map((entry) => entry.id);
    sortSeries(series, "bookCount", "desc");
    expect(series.map((entry) => entry.id)).toEqual(originalOrder);
  });
});
