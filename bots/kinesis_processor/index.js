"use strict";
const moment = require("moment");
const zlib = require("zlib");
const leo = require("leo-sdk");
const ls = leo.streams;
const async = require("async");
const refUtil = require("leo-sdk/lib/reference.js");

const cron = leo.bot;

const pad = "0000000";
const padLength = -1 * pad.length;

const StreamTable = leo.configuration.resources.LeoStream;
const EventTable = leo.configuration.resources.LeoEvent;
const ttlSeconds = parseInt(process.env.ttlSeconds) || 604800; // Seconds in a week

exports.handler = function(event, context, callback) {

	let eventsToSkip = {};
	let botsToSkip = {};

	if (process.env.skip_events) {
		eventsToSkip = process.env.skip_events.split(",").reduce((out, e) => {
			console.log(`Skipping all events to queue "${e}"`);
			out[refUtil.ref(e)] = true;
			out[e] = true;
			return out;
		}, {});
	}
	if (process.env.skip_bots) {
		botsToSkip = process.env.skip_bots.split(",").reduce((out, e) => {
			console.log(`Skipping all events from bot "${e}"`);
			out[e] = true;
			return out;
		}, {});
	}

	var timestamp = moment.utc(event.Records[0].kinesis.approximateArrivalTimestamp * 1000);
	var ttl = Math.floor(timestamp.clone().add(ttlSeconds, "seconds").valueOf() / 1000);

	var diff = moment.duration(moment.utc().diff(timestamp));
	var currentTimeMilliseconds = moment.utc().valueOf();

	var useS3Mode = false;
	if (diff.asSeconds() > 3 || event.Records.length > 100) {
		useS3Mode = true;
	}
	var events = {};
	var maxKinesis = {};
	var snapshots = {};
	var stats = {};

	let eventIdFormat = "[z/]YYYY/MM/DD/HH/mm/";
	var eventId = timestamp.format(eventIdFormat) + timestamp.valueOf();
	var recordCount = 0;

	function getEventStream(event, forceEventId, archive = null) {
		if (!(event in events)) {
			var assignIds = ls.through((obj, done) => {
				if (archive) {
					obj.end = archive.end;
					obj.start = archive.start;
				} else {
					if (forceEventId) {
						obj.start = forceEventId + "-" + (pad + recordCount).slice(padLength);
						obj.end = forceEventId + "-" + (pad + (recordCount + obj.end)).slice(padLength);
					} else {
						obj.start = eventId + "-" + (pad + recordCount).slice(padLength);
						obj.end = eventId + "-" + (pad + (recordCount + obj.end)).slice(padLength);
					}
					obj.ttl = ttl;
				}
				maxKinesis[event].max = obj.end;
				recordCount += obj.records;
				obj.v = 2;

				for (let botid in obj.stats) {
					if (!(botid in stats)) {
						stats[botid] = {
							[event]: obj.stats[botid]
						};
					} else {
						if (!(event in stats[botid])) {
							stats[botid][event] = obj.stats[botid];
						} else {
							let s = stats[botid][event];
							let r = obj.stats[botid];
							s.units += r.units;
							s.start = r.start;
							s.end = r.end;
							s.checkpoint = r.checkpoint;
						}
					}
				}
				delete obj.stats;
				delete obj.correlations;
				
				if (obj.records) { 
					done(null, obj);
				} else {
					done();
				}
			});
			if (useS3Mode) {
				events[event] = ls.pipeline(ls.toS3GzipChunks(event, {}), assignIds, ls.toDynamoDB(StreamTable));
			} else {
				events[event] = ls.pipeline(ls.toGzipChunks(event, {}), assignIds, ls.toDynamoDB(StreamTable));
			}
			maxKinesis[event] = {
				max: null
			};
		}
		return events[event];
	}

	function closeStreams(callback) {
		var tasks = [];
		var eventUpdateTasks = [];

		for (let event in events) {
			tasks.push((done) => {
				console.log("closing streams", event);
				events[event].on("finish", () => {
					console.log("got finish from stream", event, maxKinesis[event].max);
					eventUpdateTasks.push({
						table: EventTable,
						key: {
							event: event
						},
						set: {
							max_eid: maxKinesis[event].max,
							timestamp: moment.now(),
							v: 2
						}
					});

					if (event.match(/\/_archive$/)) {
						let oEvent = event.replace(/\/_archive$/, '');

						eventUpdateTasks.push({
							table: EventTable,
							key: {
								event: oEvent
							},
							set: {
								archive: {
									end: maxKinesis[event].max
								}
							}
						});
					}
					done();
				}).on("error", (err) => {
					console.log(err);
					done(err);
				});
				events[event].end();
			});
		}

		Object.keys(snapshots).forEach(event => {
			let oEvent = event.replace(/\/_snapshot$/, '');
			eventUpdateTasks.push({
				table: EventTable,
				key: {
					event: oEvent
				},
				set: {
					snapshot: snapshots[event]
				}
			});
		});

		async.parallel(tasks, (err) => {
			if (err) {
				console.log("error");
				console.log(err);
				callback(err);
			} else {
				console.log("finished writing");
				leo.aws.dynamodb.updateMulti(eventUpdateTasks, (err) => {
					if (err) {
						callback("Cannot write event locations to dynamoDB");
					} else {
						var checkpointTasks = [];
						for (let bot in stats) {
							for (let event in stats[bot]) {
								let stat = stats[bot][event];
								checkpointTasks.push(function(done) {
									cron.checkpoint(bot, event, {
										eid: eventId + "-" + (pad + stat.checkpoint).slice(padLength),
										source_timestamp: stat.start,
										started_timestamp: stat.end,
										ended_timestamp: timestamp.valueOf(),
										records: stat.units,
										type: "write"
									}, function(err) {
										done(err);
									});
								});
							}
						}
						console.log("checkpointing");
						async.parallelLimit(checkpointTasks, 100, function(err) {
							if (err) {
								console.log(err);
								callback(err);
							} else {
								callback(null, "Successfully processed " + event.Records.length + " records.");
							}
						});
					}
				});
			}
		});
	}

	var stream = ls.parse(true);
	ls.pipe(stream, ls.through((event, callback) => {
		//We can't process it without these
		if (event._cmd) {
			if (event._cmd == "registerSnapshot") {
				snapshots[refUtil.ref(event.event + "/_snapshot").queue().id] = {
					start: "_snapshot/" + moment(event.start).format(eventIdFormat),
					next: moment(event.next).format(eventIdFormat)
				};
			}
			return callback();
		} else if (!event.event || ((!event.id || !event.payload) && !event.s3) || eventsToSkip[refUtil.ref(event.event)] || botsToSkip[event.id]) {
			return callback(null);
		}
		let forceEventId = null;
		let archive = null;
		if (event.archive) {
			event.event = refUtil.ref(event.event + "/_archive").queue().id;
			archive = {
				start: event.start,
				end: event.end
			};
		} else if (event.snapshot) {
			event.event = refUtil.ref(event.event + "/_snapshot").queue().id;
			forceEventId = moment(event.snapshot).format(eventIdFormat) + timestamp.valueOf();
		} else {
			event.event = refUtil.ref(event.event).queue().id;
		}

		//If it is missing these, we can just create them.
		if (!event.timestamp) {
			event.timestamp = currentTimeMilliseconds;
		}
		if (!event.event_source_timestamp) {
			event.event_source_timestamp = event.timestamp;
		}
		if (typeof event.event_source_timestamp !== "number"){
		    event.event_source_timestamp = moment(event.event_source_timestamp).valueOf();
		}
		getEventStream(event.event, forceEventId, archive).write(event, callback);
	}), function(err) {
		if (err) {
			callback(err);
		} else {
			closeStreams(callback);
		}
	});
	event.Records.map((record) => {
		if (record.kinesis.data[0] === 'H') {
			stream.write(zlib.gunzipSync(new Buffer(record.kinesis.data, 'base64')));
		} else if (record.kinesis.data[0] === 'e' && record.kinesis.data[1] === 'J') {
			stream.write(zlib.inflateSync(new Buffer(record.kinesis.data, 'base64')));
		} else if (record.kinesis.data[0] === 'e' && record.kinesis.data[1] === 'y') {
			stream.write(Buffer.from(record.kinesis.data, 'base64').toString() + "\n");
		}
	});
	stream.end();
};
