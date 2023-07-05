const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const axios = require('axios');
const fs = require('node:fs');

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
	const botMessage = {
		chat_id: chatId,
		reply_to_message_id: messageId,
		parse_mode: 'MarkdownV2'
	};
	
	switch (getMessageType(userMessage)) {
		case 'text':
            const textCommand = userMessage.text.match(/^\/(start|profile|info|credit|image )/);
			if (textCommand) {
				
				const words = userMessage.text.split(' ');
				switch (textCommand[0]) {
					case '\/start':
						botMessage.text = 'start';
						
						break;
					case '\/profile':
						botMessage.text = `🪪 *ID:* \`${user.userId}\`\n👤 *NAME:* \`${userName}\`\n💰 *CREDIT:* ${user.credit}`;
						break;
					case '\/info':
						
						botMessage.text = 'info';
						break;
					case '\/credit':
						await sendTelegramAction(chatId, 'typing');
						botMessage.text = fs.readFileSync('./files/credit.txt', 'utf-8');
						break;
					case '\/image ':
						if (user.credit >= 3) {
							if (words.length >= 4) {
								await sendTelegramAction(chatId, 'upload_photo');
								const imageCompletion = await createImage(userMessage.text.replace('/image ', ''));
								if (imageCompletion?.data && Array.isArray(imageCompletion.data)) {
									
									botMessage.photo = imageCompletion.data[0].url;
									botMessage.caption = 'Powered by: \`DALL-E\`';
									await aiqueryDB.collection('users').updateOne(
										{ userId: user.userId, credit: { $gte: 3 } },
										{ $inc: { credit: -3 } }
									);
								} else {
									
									botMessage.text = JSON.stringify(imageCompletion);
								}
							} else {
								
								botMessage.text = 'Error: You need to define at least 3 words for describing image.';
							}
						} else {
							
							botMessage.content = 'Sorry! But you don\'t have enough credit to perform that request. You need 3 credit for every image request.';
						}
						break;
			    }
			} else {
				await sendTelegramAction(chatId, 'typing');
				if (user.credit > 0) {
					const messages = [
						{ "role": "system", "content": "### You are AI QUERY GPT and powered by OpenAI using the latest model GPT-4 also equipped with DALL-E." },
						{ "role": "user", "content": userMessage.text }
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
						botMessage.text = chatCompletion.choices[0].message.content;
						await aiqueryDB.collection('users').updateOne(
							{ userId: user.userId, credit: { $gt: 0 } },
							{ $inc: { credit: -1 } }
						);
					} else {
						botMessage.text = JSON.stringify(chatCompletion);
					}
				} else {
					botMessage.text = 'Sorry! But you don\'t have enough credit to perform that request. You need atleast 1 credit for GPT-4 prompt.';
				}
			}
			break;
		default:
			botMessage.text = 'Unsupported message type.';
	}
	response.send(await sendTelegramMessage(botMessage));
});

async function sendTelegramAction(chatId, action) {
	const response = await executeAxiosRequest({
		method: 'post',
		url: `https://api.telegram.org/bot${process.env.AIQUERY_BOT_TOKEN}/sendChatAction`,
		data: {
			chat_id: chatId,
			action: action
		}
	});
	return response.data;
}

async function sendTelegramMessage(message) {
	let path;
	switch (getMessageType(message)) {
		case 'text':
			path = 'sendMessage';
			message.text = message.text.replace(/([-_\[\]()~>#+=|{}.!])/g, "\\$1");
			break;
		case 'voice':
			break;
		case 'photo':
			path = 'sendPhoto';
			break;
		case 'video':
			break;
		case 'document':
			break;
	}
	const response = await executeAxiosRequest({
		method: 'post',
		url: `https://api.telegram.org/bot${process.env.AIQUERY_BOT_TOKEN}/${path}`,
		data: message
	});
	return response.data;
}

async function createChatCompletion(messages) {
	const response = await executeAxiosRequest({
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
	return response.data;
}

async function createImage(description) {
	const response = await executeAxiosRequest({
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
	return response.data;
}

function getMessageType(message) {
	return ['text', 'voice', 'photo', 'video', 'document'].find(type => message[type]);
}

async function executeAxiosRequest(request) {
	try {
	   return await axios(request);
	} catch (error) {
	   if (error.response) {
		   return error.response;
	   } else {
		   return {
			   status: 500,
			   data: {
				   error: error.message
			   }
		   };
	   }
	}
}

app.listen(3000, () => {
	console.log(`Server is listening on port 3000`);
});
