import { useEffect } from "react";
import { useHomeShelves } from "../hooks/use-home-shelves";
import { publishCarPlayShelves } from "./carplay-service";

/**
 * Invisible bridge between the home-shelf derivation (React/query-bound) and
 * the CarPlay service. Mounted once in the root layout: whenever the visible
 * shelves change, they're handed to the CarPlay service, which renders them in
 * the car and snapshots them for headless cold launches.
 */
export const CarPlayShelfPublisher = () => {
	const { visibleShelves, progressByBookId } = useHomeShelves();

	useEffect(() => {
		publishCarPlayShelves(visibleShelves, progressByBookId);
	}, [visibleShelves, progressByBookId]);

	return null;
};
