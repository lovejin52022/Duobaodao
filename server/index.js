const puppeteer = require('puppeteer-core');
const findChrome = require('../node_modules/carlo/lib/find_chrome.js');
const querystring = require("querystring");
const https = require("https");
const API = require("./api");

// 商品的ID
let Item_ID;

// 最高能接受的价格
let MaxPrice;

// 初始刷新频率
let NextRefreshTime = 2000;

// 从发出请求，到请求成功的时间
// let RequestDelay = 100;

let Item_URL;
let OfferPricePara = null;
let OfferPriceUrlPara = null;

let page;
let NowPrice;
let EndTime;
let CurrentTime;
let Cookie = null;
let OfferPriceTimer = null;
let BoomTimer;
let OfferPriceDelay = 200;


/**
 * 启动浏览器，加载页面
 * */
function goToBid(id, price) {
	Item_ID = id;
	MaxPrice = price;
	Item_URL = API.item_url + Item_ID;
	OfferPriceTimer = null;
	initBid();
}

function search(id) {
	let test = "body=%7B%22address%22%3A%2222-1930-50949-52155%22%2C%22auctionId%22%3A382210142%2C%22price%22%3A4889%2C%22entryid%22%3A%22%22%2C%22eid%22%3A%2236KYU55A7PBREDLNKLQ6C3QKG4JRTY2YSCZQJFKVCSE3QWD4UETGNLSGHGO5UFX7BEMCTLZ33A2MIUB3YSDLC22RTM%22%2C%22transformRequest%22%3A%5Bnull%5D%7D";
	let res = querystring.unescape(test.substring(5));
	let jso = JSON.parse(res);
	jso.price = 110;
	para = {body: jso};
	para.body = JSON.stringify(para.body);
	console.log("test  " + querystring.stringify(para));
}


/**
 * 启动浏览器，加载页面
 * */
async function initBid() {
	let findChromePath = await findChrome({});
	let executablePath = findChromePath.executablePath;

	const browser = await puppeteer.launch({
		executablePath,
		headless: false,
		defaultViewport: {
			width: 1920,
			height: 1080,
			isLandscape: true
		},
		args: ['--start-maximized']
	});
	page = await browser.newPage();

	// 首先加载登录页面
	await page.goto(API.login_url);

	page.on("load", async function () {
		// 利用页面加载完成事件，判断是否是登录成功后的页面跳转
		if (page.url() === API.login_success_redirect_url) {
			await page.goto(Item_URL);

			// 需要使用两个页面的cookie
			let jd_cookie = await page.cookies(API.login_url);
			let page_cookie = await page.cookies();
			let api = API.api_jd + "?functionId=paipai.auction.offerPric"
			Cookie = mergeCookie(jd_cookie, page_cookie);

			console.log("等待商品页面加载完成，请手动完成页面人机验证")
			await waitItemPageLoadFinish();

			// 查询当前的价格和剩余时间
			getBatchInfo(async function () {
				// 启用拦截器

				await page.setRequestInterception(true);
				// 对出价进行拦截，目的在于获取加密参数，不需要真实出价，所以需要拦截，后续的出价请求不能拦截
				page.on("request", async function (request) {
					if (request.url().indexOf(api) !== -1) {

						let post_data = request.postData();
						if (post_data) {
							let urls = request.url().split("?");
							let param = querystring.parse(urls[1])
							if (!OfferPriceUrlPara) {
								OfferPriceUrlPara = param;
							}
							let post_data_str = querystring.unescape(post_data.substring(5));
							let post_data_obj = JSON.parse(post_data_str);
							if (!OfferPricePara) {
								OfferPricePara = post_data_obj;
								console.log("加密参数获取成功！！");
								request.abort();
								return;
							}
						}

						request.continue();
					} else {
						request.continue();
					}
				});

				// 通过页面操作，模拟真实的用户操作，以便获取加密参数
				await buyByPage(1);
				setTimeout(function (){
					handlePriceAndTime();
				}, 5000);
			});
		}
	});
}

module.exports = {goToBid, search};

/**
* 判断是否进入商品页面，因为会进行人机认证，需要确保后续逻辑，再进入商品页面后再执行
* */
async function waitItemPageLoadFinish() {
	let button = null;

	do {
		button = await page.$("#InitCartUrl");
	} while (button === null);
}

function getDetailInfo(id) {
	const url = API.api_jd + "?functionId=paipai.auction.current_bid_info&appid=paipai_sale_pc&client=pc&body=%7B%22auctionId%22:" + Item_ID + "%7D";
	const options = {
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
			"Referer": "https://1paipai.jd.com/",
			"Origin": "https://1paipai.jd.com/"
		}
	}
	https.get(url, options, function (res) {
		let rawData = '';
		res.on('data', (chunk) => {
			rawData += chunk;
		});
		res.on('end', () => {
			try {

				const parsedData = JSON.parse(rawData);
				if (parsedData.result.data) {
					let auctionInfo = parsedData.result.data.auctionInfo;
					let productBaseInfo = parsedData.result.data.productBaseInfo;
					let historyRecord = parsedData.result.data.historyRecord;
				}
			} catch (e) {
				console.error(e.message);
			}
		});
	}).on('error', (e) => {
		console.error(e);
	})

}


/**
 * 获得竞拍实时信息
 * */
function getBatchInfo(callback) {
	const url = API.api_jd + "?functionId=paipai.auction.current_bid_info&appid=paipai_sale_pc&client=pc&body=%7B%22auctionId%22%3A" + Item_ID + "%7D";
	const agent = API.item_result + Item_ID;
	const options = {
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
			"Referer": "https://1paipai.jd.com/",
			"Origin": "https://1paipai.jd.com/",
			"X-Referer-Page": agent
		}
	}
	https.get(url, options, function (res) {
		let rawData = '';
		res.on('data', (chunk) => {
			rawData += chunk;
		});
		res.on('end', () => {
			try {

				const parsedData = JSON.parse(rawData);
				if (parsedData.result.data && parsedData.result.data[Item_ID]) {
					NowPrice = parsedData.result.data[Item_ID].currentPrice;
					EndTime = parsedData.result.data[Item_ID].actualEndTime;
					CurrentTime = parsedData.result.list[0];
					callback();
				}
			} catch (e) {
				console.error(e.message);
			}
		});
	}).on('error', (e) => {
		console.error(e);
	})
}


// function BoomToOfferPrice() {
// 	BoomTimer = setInterval(function () {
// 		getBatchInfo(handlePriceAndTime);
// 	}, 10);
// }

/**
 * 根据当前的出价和剩余时间做处理
 * 若剩余时间大于3s，每2s刷新一次，小于3s，就100ms刷新一次
 * 执行购买逻辑
 * */
function handlePriceAndTime() {

	const price = NowPrice;
	const time = EndTime - CurrentTime;

	console.log("当前价格：" + price);
	console.log("剩余抢购时间（毫秒）：" + time);

	if (!OfferPricePara) {
		console.log("正在获取加密参数");
		buyByPage(1);
		return;
	}

	if (price + 1 > MaxPrice) {
		console.log("超过最高价格，抢购结束");
		return;
	}

	if (time < 0) {
		console.log("抢购时间结束");
		clearInterval(BoomTimer);
		return;
	}

	if (!OfferPriceTimer && time < 1500) {
		console.log("开启定时下单");
		OfferPriceTimer = setTimeout(function () {
			buyByAPI(price+3);
		}, time - 600 ) 
	}

	// if (time < 2000) {
	// 	if (BoomTimer === undefined) {
	// 		BoomToOfferPrice();
	// 	}
	// } else {
	// 	console.log(new Date().getTime() + ":" + `出价${price + 1}`);
	// 	buyByAPI(price + 1);
	// }
	//
	// if (time < RequestDelay * 1.5) {
	// 	console.log(new Date().getTime() + ":" + `出价${price + 1}`);
	// 	buyByAPI(price + 1);
	// }

	if (time < 3000  && time > 350) {
		setTimeout(function () {
			getBatchInfo(handlePriceAndTime);
		}, 5)
	} else {
		setTimeout(function () {
			getBatchInfo(handlePriceAndTime);
		}, NextRefreshTime)
	}

	
}

/**
 * 通过操作页面的按钮，来进行出价
 * */
async function buyByPage(price) {
	// 点击输入框右边，以便光标能在最右边，删除键能删除所有的输入
	await page.mouse.click(1000, 492);
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await page.keyboard.type(price.toString());
	// await page.mouse.click(900, 720);
	try {
		await page.click("#InitCartUrl");
	} catch (e) {
		console.log(e)
	}
}

/**
 * 通过直接调用api接口去出价
 * */
async function buyByAPI(price) {
	if (OfferPricePara === null) {
		console.log("没有正确获取到拍卖参数，无法执行购买");
	} else {
		return requestOfferPrice({
			body: OfferPricePara
		});
	}
}

/**
 * 发出出价的请求
 * */
function requestOfferPrice(para) {
	return new Promise((resolve, reject) => {
		para.body.price = NowPrice + 3;
		console.log(`出价：${NowPrice + 3}元`)
		// data的encode方式有点奇怪
		para.body = JSON.stringify(para.body);
		let postData = querystring.stringify(para);
		OfferPriceUrlPara.t = new Date().getTime();
		let urlData = querystring.stringify(OfferPriceUrlPara);
		let path = `${API.api_jd_path}?${urlData}`;

		const options = {
			hostname: API.api_jd_hostname,
			port: 443,
			path: path,
			method: "POST",
			headers: {
				"Content-Type": 'application/x-www-form-urlencoded',
				"Content-Length": Buffer.byteLength(postData),
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.100 Safari/537.36",
				"Cookie": Cookie,
				"Referer": "https://paipai.jd.com/",
				"Sec-Fetch-Mode": "cors"
			}
		};

		const req = https.request(options, (res) => {
			let rawData = "";

			res.setEncoding('utf8');

			res.on('data', (chunk) => {
				rawData += chunk;
			});

			res.on('end', () => {
				console.log(new Date().getTime() + ":" + rawData);
				resolve();
			});
		});

		req.on('error', (e) => {
			console.error(`请求遇到问题: ${e.message}`);
			reject(e);
		});

		req.write(postData);
		req.end();
	});
}

/**
 * 处理cookie，将两个页面的cookie合并到一起
 * */
function mergeCookie(cookie_one, cookie_two) {
	let cookie = {};
	let string = "";
	for (let i in cookie_two) {
		cookie[cookie_two[i].name] = cookie_two[i].value;
	}

	for (let i in cookie_one) {
		cookie[cookie_one[i].name] = cookie_one[i].value;
	}

	for (let i in cookie) {
		string += `${i}=${cookie[i]};`
	}

	return string;
}