'use strict';

const HELPER_BASE = process.env.HELPER_BASE || "/opt/";
const Response = require(HELPER_BASE + 'response');
const Redirect = require(HELPER_BASE + 'redirect');

const SWITCHBOT_OPENTOKEN = "【SwitchBotのトークン】";
const SwitchBot = require('./switchbot');
const switchbot = new SwitchBot(SWITCHBOT_OPENTOKEN);
const jsonfile = require(HELPER_BASE + 'jsonfile-utils');

const { URL, URLSearchParams } = require('url');
const fetch = require('node-fetch');
const Headers = fetch.Headers;

const DATA_FILE = process.env.THIS_BASE_PATH + "/data/irremocon/data.json";
const crypto = require('crypto');
const REGISTER_DURATION = 20000;

var dgram = require("dgram");
var udp = dgram.createSocket("udp4");

const UDP_SEND_PORT	= 20001;

let registering = null;
let last_code = null;

//(async () =>{
//	console.log(await switchbot.getDeviceList());
//})();

async function irremocon_call(body){
	var list = await jsonfile.read_json(DATA_FILE, []);
	var item = list.find(item => {
		if( body.type == "ir_received" )
			return (body.type == item.type && item.ir.decode_type == body.decode_type && item.ir.address == body.address && item.ir.command == body.command );
		else if( body.type == "button_pressed" )
			return (body.type == item.type && item.button.button_type == body.button_type );
		else
			throw false;
	});
	if( !item )
		throw new Error('item not found');
	if( !item.action )
		throw new Error('action not defined');

	switch(item.action.type){
		case "ir":{
			var ir_item = list.find( item2 => item2.id == item.action.id && item2.type == "ir_received" );
			if( !ir_item )
				throw "ir_item not found";
			console.log(ir_item);
			var data = {
				type: "ir_send",
				rawbuf: ir_item.ir.rawbuf
			};
			var ipaddress = body.ipaddress ? body.ipaddress : event.remote.address;
			udp.send(JSON.stringify(data), UDP_SEND_PORT, ipaddress, () =>{
				console.log('udp ir_send ok');
			});
			break;
		}			
		case "switchbot": {
			console.log(item.action);
			switch(item.action.commandType){
				case 'command': {
					await switchbot.sendDeviceControlCommand(item.action.deviceId, 'command', item.action.command, 'default');
					console.log("switchbot command ok");
					break;
				}
				case 'customize': {
					await switchbot.sendDeviceControlCommand(item.action.deviceId, 'customize', item.action.command, 'default');
					console.log("switchbot costomize ok");
					break;
				}
			}
			break;
		}
		case "http": {
			switch(item.action.methodType){
				case 'post': {
					await do_post(item.action.url, JSON.parse(item.action.params));
					console.log("http post ok");
					break;
				}
				case 'get': {
					await do_get(item.action.url, JSON.parse(item.action.params));
					console.log("http get ok");
					break;
				}
			}
			break;
		}
		case "udp": {
			udp.send(item.action.payload, item.action.port, item.action.host, (err, bytes) =>{
				if( err )
					console.error(error);
			});
			break;
		}
		default:
			throw 'unknown action type';
	}	
}

exports.udp_handler = async (event, context) => {
  console.log(event);
  var body = JSON.parse(event.body);

	var now = new Date().getTime();
	if( registering && now <= (registering.started_at + REGISTER_DURATION) ){
		if( !registering.id ){
			last_code = body;
			registering = null;
			return;
		}
		if( body.type == "ir_received" ){
			var list = await jsonfile.read_json(DATA_FILE, []);
			var item = list.find(item => item.id == registering.id );
			if( !item ){
				var t = list.find(item => item.type == "ir_received" && item.ir.decode_type == body.decode_type && item.ir.address == body.address && item.ir.command == body.command );
				if( t )
					throw "code duplicated";
				item = {
					type: "ir_received",
					id: registering.id,
					name: registering.name,
					ir: body,
					ipaddress: event.remote.address,
					port: event.remote.port,
				};
				list.push(item);
			}else{
				item.ir = body;
				item.ipaddress = event.remote.address;
				item.port = event.remote.port;
			}
		}else if( body.type == "button_pressed" ){
			var list = await jsonfile.read_json(DATA_FILE, []);
			var item = list.find(item => item.id == registering.id );
			if( !item ){
				var t = list.find(item => item.type == "button_pressed" && item.button.button_type == body.button_type );
				if( t )
					throw "code duplicated";
				item = {
					type: "button_pressed",
					id: registering.id,
					name: registering.name,
					button: body,
					ipaddress: event.remote.address,
					port: event.remote.port,
				};
				list.push(item);
			}else{
				item.button = body;
				item.ipaddress = event.remote.address;
				item.port = event.remote.port;
			}
		}else{
			throw "now registering";
		}
		console.log(list);
		registering = null;
		await jsonfile.write_json(DATA_FILE, list);
	}else{
		await irremocon_call(body);
	}
};

exports.handler = async (event, context, callback) => {
	var body = JSON.parse(event.body);
	console.log(body);
	if( event.path == "/irremocon-switchbot-devicelist" ){
		var list = await switchbot.getDeviceList();
		return new Response(list);
	}else

	if( event.path == "/irremocon-call" ){
		await irremocon_call(body);
		return new Response({});
	}else

	if( event.path == "/irremocon-list" ){
		var list = await jsonfile.read_json(DATA_FILE, []);

		list = list.sort((first, second) => {
			if(first.name < second.name) return -1;
			else if(first.name > second.name) return 1;
			else return 0;
		});

		return new Response({ list: list, registering: registering, last_code: last_code });
	}else

	if( event.path == "/irremocon-delete" ){
		var id = body.id;
		var list = await jsonfile.read_json(DATA_FILE, []);
		var index = list.findIndex(item => item.id == id);
		if( index < 0)
			throw new Error('not found');
		list.splice(index, 1);
		await jsonfile.write_json(DATA_FILE, list);
		return new Response({});
	}else

	if( event.path == "/irremocon-update" ){
		var list = await jsonfile.read_json(DATA_FILE, []);
		var item = list.find(item => item.id == body.id );
		if( !item )
			throw new Error('item not found');

		if( body.name !== undefined ) item.name = body.name;
		if( body.action !== undefined ) item.action = body.action;

		await jsonfile.write_json(DATA_FILE, list);

		return new Response({});
	}else

	if( event.path == "/irremocon-start-register" ){
		last_code = null;
		var id = body.id;
		registering = {
			id: id ? id : crypto.randomUUID(),
			name: body.name,
			started_at: new Date().getTime()
		}
		return new Response({ start: registering.started_at, end: registering.started_at + REGISTER_DURATION });
	}else

	if( event.path == "/irremocon-start-check" ){
		last_code = null;
		registering = {
			started_at: new Date().getTime()
		}
		return new Response({ start: registering.started_at, end: registering.started_at + REGISTER_DURATION });
	}else

	{
		throw "unknown endpoint";		
	}
};

function do_post(url, body) {
  const headers = new Headers({ "Content-Type": "application/json" });

  return fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: headers
    })
    .then((response) => {
      if (!response.ok)
        throw new Error('status is not 200');
			return true;
//      return response.json();
    });
}

function do_get(url, qs) {
  var params = new URLSearchParams(qs);

  var params_str = params.toString();
  var postfix = (params_str == "") ? "" : ((url.indexOf('?') >= 0) ? ('&' + params_str) : ('?' + params_str));
  return fetch(url + postfix, {
      method: 'GET',
    })
    .then((response) => {
      if (!response.ok)
        throw new Error('status is not 200');
			return true;
//				return response.json();
    });
}
