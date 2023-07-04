const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const mongoClient = new MongoClient(process.env.AIQUERY_DB_URI, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	}
});

app.get('/', (request, response) => {
	response.send('Hello, world!');
});

app.post('/', async (request, response) => {
	const data = request.body;
	const userMessage = data.message;
	const messageId = userMessage.message_id;
	const userId = userMessage.from.id;
	const chatId = userMessage.chat.id;
	const userName = (userMessage.from.last_name) ? `${userMessage.from.first_name} ${userMessage.from.last_name}` : userMessage.from.first_name;
	aiqueryDB = mongoClient.db("ai-query-db");

	user = await (async () => {
		let databaseUser = await aiqueryDB.collection('users').findOne({ userId: userId });
		if (databaseUser) {
			return databaseUser;
		} else {
			databaseUser = {
				userId: userId,
				credit: 10
			};
			await aiqueryDB.collection('users').insertOne(databaseUser);
		}
		return databaseUser;
	})();
	let botMessage = {};
	const messageType = ['text', 'voice', 'photo', 'video', 'document'].find(type => userMessage[type]);
	switch (messageType) {
		case 'text':
            const textCommand = userMessage[messageType].match(/^\/(start|profile|info|image )/);
			if (textCommand) {
				botMessage.reply = true;
				const words = userMessage[messageType].split(' ');
				switch (textCommand[0]) {
					case '\/start':
						botMessage.type = 'text';
						botMessage.content = 'start';
						break;
					case '\/profile':
						botMessage.type = 'text';
						botMessage.content = `🪪 *ID:* \`${user.userId}\`\n👤 *NAME:* \`${userName}\`\n💰 *CREDIT:* ${user.credit}`;
						break;
					case '\/info':
						botMessage.type = 'text';
						botMessage.content = 'info';
						break;
					case '\/image ':
						if (user.credit >= 3) {
							if (words.length >= 4) {
								await sendTelegramAction(chatId, 'upload_photo');
								const imageCompletion = await createImage(userMessage[messageType].replace('/image ', ''));
								if (imageCompletion?.data && Array.isArray(imageCompletion.data)) {
									botMessage.type = 'image';
									botMessage.content = imageCompletion.data[0].url;
									await aiqueryDB.collection('users').updateOne(
										{ userId: user.userId, credit: { $gte: 3 } },
										{ $inc: { credit: -3 } }
									);
								} else {
									botMessage.type = 'text';
									botMessage.content = JSON.stringify(imageCompletion);
								}
							} else {
								botMessage.type = 'text';
								botMessage.content = 'Error: You need to define at least 3 words for describing image.';
							}
						} else {
							botMessage.type = 'text';
							botMessage.content = 'Sorry! But you don\'t have enough credit to perform that request. You need 3 credit for every image request.';
						}
						break;
			    }
			} else {
				botMessage.reply = false;
				botMessage.type = 'text';
				await sendTelegramAction(chatId, 'typing');
				if (user.credit > 0) {
					const messages = [
						{ "role": "system", "content": "### You are AI QUERY GPT and powered by OpenAI using the latest model GPT-4 also equipped with DALL-E." },
						{ "role": "user", "content": userMessage[messageType] }
					];
					if (userMessage.reply_to_message?.text) {
						const includedMessage = {
							"role": (userMessage.reply_to_message.from.is_bot) ? "assistant" : "user",
							"content": userMessage.reply_to_message.text
						};
						messages.splice(1, 0, includedMessage);
					}
					const chatCompletion = await createChatCompletion(messages);
					if (chatCompletion?.choices[0]?.message?.content) {
						botMessage.content = chatCompletion.choices[0].message.content;
						await aiqueryDB.collection('users').updateOne(
							{ userId: user.userId, credit: { $gt: 0 } },
							{ $inc: { credit: -1 } }
						);
					} else {
						botMessage.content = JSON.stringify(chatCompletion);
					}
				} else {
					botMessage.content = 'Sorry! But you don\'t have enough credit to perform that request. You need atleast 1 credit for GPT-4 prompt.';
				}
			}
			break;
		default:
			botMessage.reply = true;
			botMessage.type = 'text';
			botMessage.content = 'Unsupported message type.';
	}
	response.status(200).json(await sendTelegramMessage(chatId, messageId, botMessage));
});

async function getTelegramFileData(fileId) {
	return await executeAxiosRequest({
		method: 'get',
		url: `https://api.telegram.org/bot${process.env.AIQUERY_BOT_TOKEN}/getFile`,
		params: {
			file_id: fileId
		}
	});
}

async function getTelegramFileBuffer(filePath) {
	return await executeAxiosRequest({
		method: 'get',
		url: `https://api.telegram.org/bot${process.env.AIQUERY_BOT_TOKEN}/${filePath}`,
		responseType: 'stream'
	});
}

async function sendTelegramAction(chatId, action) {
	return await executeAxiosRequest({
		method: 'post',
		url: `https://api.telegram.org/bot${process.env.AIQUERY_BOT_TOKEN}/sendChatAction`,
		data: {
			chat_id: chatId,
			action: action
		}
	});
}

async function sendTelegramMessage(chatId, messageId, message) {
	let url;
	const data = {
		chat_id: chatId,
	};
	if (message.reply) {
		data.reply_to_message_id = messageId;
	}
	switch (message.type) {
		
		case 'image':
			url = `https://api.telegram.org/bot${process.env.AIQUERY_BOT_TOKEN}/sendPhoto`;
			data.photo = message.content;
			data.caption = 'Powered by \`DALL-E\`';
			data.parse_mode = 'MarkdownV2';
			break;
		case 'video':

			break;
		case 'document':

			break;
		default:
			url = `https://api.telegram.org/bot${process.env.AIQUERY_BOT_TOKEN}/sendMessage`;
			data.text = (message.content).replace(/([-_\[\]()~>#+=|{}.!])/g, "\\$1");
			data.parse_mode = 'MarkdownV2';
			break;
	}
	return await executeAxiosRequest({
		method: 'post',
		url: url,
		data: data
	});
}

async function createChatCompletion(messages) {
	return await executeAxiosRequest({
		method: 'post',
		url: 'https://api.openai.com/v1/chat/completions',
		headers: {
			'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json'
		},
		data: {
			model: "gpt-3.5-turbo",
			messages: messages,
			temperature: 0.4,
			max_tokens: 1000
		}
	});
}

async function createImage(description) {
	return await executeAxiosRequest({
		method: 'post',
		url: 'https://api.openai.com/v1/images/generations',
		headers: {
			'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json'
		},
		data: {
			prompt: description,
			n: 1,
			size: '1024x1024'
		}
	});
}

async function executeAxiosRequest(request) {
	try {
		response = await axios(request);
		return response.data;
	} catch (error) {
		if (error.response) {
			return error.response.data;
		} else {
			return {
				error: error.message
			};
		}
	}
}

app.listen(3000, () => {
	console.log(`Server is listening on port 3000`);
});
