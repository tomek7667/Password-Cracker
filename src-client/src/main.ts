import * as path from "path";
import {
	app,
	BrowserWindow,
	ipcMain,
	IpcMainEvent,
	IpcMainInvokeEvent,
} from "electron";
import { io, Socket } from "socket.io-client";
import { createMessage } from "./Message";
import {
	BruteForceJob,
	jobFromJson,
	JobResult,
	WordlistJob,
} from "./JobInterface";
import { fulfillBruteForceJob, fulfillWordlistJob } from "./jobsFunctions";
import { Worker } from "worker_threads";

let mainWindow: BrowserWindow;
let socket: Socket;

const IS_DEVELOPMENT = false;
let SERVER_HOST = "http://0.0.0.0:5555";

const createWindow = () => {
	console.log(path.join(__dirname, "../prld.js"));
	mainWindow = new BrowserWindow({
		width: 1270,
		height: 720,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: true,
			preload: path.join(__dirname, "../prld.js"),
		},
	});

	mainWindow.loadFile(path.join(__dirname, "../index.html"));
	if (IS_DEVELOPMENT) {
		mainWindow.webContents.openDevTools();
	}
};

app.whenReady().then(() => {
	createWindow();

	app.on("window-all-closed", () => {
		try {
			closeSocket();
		} catch (e) {}
		app.quit();
	});
});

ipcMain.handle("submit-hash", async (event, args): Promise<boolean> => {
	log("Submitting hash...", event);
	socket.emit("data", args);
	return true;
});

ipcMain.handle("connect", async (event, host): Promise<boolean> => {
	log("Connecting to the socket server...", event);
	if (!host) {
		log("No host provided!", event);
		return false;
	}
	SERVER_HOST = host;
	socket = io(SERVER_HOST);
	const result = await addSocketListeners(event);
	return result;
});

ipcMain.handle("disconnect", async (event, args): Promise<boolean> => {
	log("Disconnecting from the socket server...", event);
	closeSocket();
	return true;
});

const log = (message: string, event: IpcMainEvent | IpcMainInvokeEvent) => {
	event.sender.send("server-log", message);
};

const addSocketListeners = (
	event: IpcMainEvent | IpcMainInvokeEvent
): Promise<boolean> => {
	return new Promise((resolve, reject) => {
		let isConnectionEstablished = false;
		socket.on("connect", () => {
			log("Connected to the socket server!", event);
			isConnectionEstablished = true;
			return resolve(true);
		});

		socket.on("log", (message: string) => {
			log(message, event);
		});

		socket.on("disconnect", () => {
			log("Disconnected from the socket server!", event);
		});

		socket.on("lifecheck", () => {
			socket.emit("lifecheck");
		});

		socket.on("job", (jobData: object) => {
			const job = jobFromJson(jobData);
			runInBackground(() => {
				fulfillJob(job);
			});
		});

		socket.on("hash-complete", (message: string) => {
			event.sender.send("hash-complete", message);
		});

		setTimeout(() => {
			if (!isConnectionEstablished) {
				log("Connection to the socket server timed out!", event);
				closeSocket();
				return resolve(false);
			}
		}, 5000);
	});
};

const fulfillJob = (job: WordlistJob | BruteForceJob): void => {
	let result: JobResult;
	switch (job.jobInformation.type) {
		case "wordlist":
			result = fulfillWordlistJob(job as WordlistJob);
			break;
		case "bruteforce":
			result = fulfillBruteForceJob(job as BruteForceJob);
			break;
	}
	socket.emit(
		"data",
		createMessage(result.messageType, result.algorithm, result.word)
	);
};

const closeSocket = () => {
	if (socket?.active) {
		socket.emit("forceDisconnect");
		socket.close();
	}
};

const runInBackground = async (fn: Function) => {
	Promise.all([fn()]);
};
