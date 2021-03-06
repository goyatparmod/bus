module.exports = {
	callbackWaitsForEmptyEventLoop: () => {},
	succeed: () => {},
	fail: () => {},
	done: () => {},
	functionVersion: '$LATEST',
	functionName: 'dev-bus-SourceQueueReplicator-222222222222',
	memoryLimitInMB: '256',
	logGroupName: '/aws/lambda/dev-bus-SourceQueueReplicator-222222222222',
	logStreamName: '2019/07/21/[$LATEST]11111111uuiduuiduuid222222222222',
	clientContext: undefined,
	identity: undefined,
	invokedFunctionArn: 'arn:aws:lambda:us-east-1:111111111111:function:dev-bus-SourceQueueReplicator-222222222222',
	awsRequestId: '11111111-uuid-uuid-uuid-222222222222',
	getRemainingTimeInMillis: () => {},
	resources: {
		LeoS3LoadTrigger: 'dev-bus-LeoS3LoadTrigger-222222222222',
		LeoS3: 'dev-bus-leos3-222222222222',
		LeoCron: 'dev-bus-LeoCron-222222222222',
		LeoFirehoseStreamProcessor: 'dev-bus-LeoFirehoseStreamProcessor-222222222222',
		LeoSettings: 'dev-bus-LeoSettings-222222222222',
		LeoBotPolicy: 'arn:aws:iam::111111111111:policy/dev-bus-LeoBotPolicy-222222222222',
		LeoFirehoseRole: 'dev-bus-LeoFirehoseRole-222222222222',
		LeoSystem: 'dev-bus-LeoSystem-222222222222',
		Region: 'us-east-1'
	},
	botId: 'testrep_random_numbers-replication',
	getCheckpoint: () => {},
	settings: {}
};
