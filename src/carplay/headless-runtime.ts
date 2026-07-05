type HeadlessCarPlayRuntimeDependencies = {
	initPlayerRuntime: () => void;
	initCarPlayRuntime: () => void;
};

export const initHeadlessCarPlayRuntime = ({
	initPlayerRuntime,
	initCarPlayRuntime,
}: HeadlessCarPlayRuntimeDependencies) => {
	initPlayerRuntime();
	initCarPlayRuntime();
};
