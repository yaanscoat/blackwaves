/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	// The require scope
/******/ 	const __webpack_require__ = {};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	// define getter/value functions for harmony exports
/******/ 	__webpack_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop));
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = (exports) => {
/******/ 		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/ 	
/************************************************************************/
let __webpack_exports__ = {};
// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  client: () => (/* reexport */ client_namespaceObject),
  extensions: () => (/* reexport */ extensions_namespaceObject),
  packet: () => (/* reexport */ packet_namespaceObject)
});

// NAMESPACE OBJECT: ./src/packet.mjs
var packet_namespaceObject = {};
__webpack_require__.r(packet_namespaceObject);
__webpack_require__.d(packet_namespaceObject, {
  ClosePayload: () => (ClosePayload),
  ConnectPayload: () => (ConnectPayload),
  ContinuePayload: () => (ContinuePayload),
  DataPayload: () => (DataPayload),
  InfoPayload: () => (InfoPayload),
  WispBuffer: () => (WispBuffer),
  WispPacket: () => (WispPacket),
  close_reasons: () => (close_reasons),
  packet_classes: () => (packet_classes),
  packet_types: () => (packet_types),
  stream_types: () => (stream_types)
});

// NAMESPACE OBJECT: ./src/extensions.mjs
var extensions_namespaceObject = {};
__webpack_require__.r(extensions_namespaceObject);
__webpack_require__.d(extensions_namespaceObject, {
  BaseExtension: () => (BaseExtension),
  MOTDExtension: () => (MOTDExtension),
  PasswordAuthExtension: () => (PasswordAuthExtension),
  UDPExtension: () => (UDPExtension),
  extensions_map: () => (extensions_map),
  parse_extensions: () => (parse_extensions),
  serialize_extensions: () => (serialize_extensions)
});

// NAMESPACE OBJECT: ./src/client/index.mjs
var client_namespaceObject = {};
__webpack_require__.r(client_namespaceObject);
__webpack_require__.d(client_namespaceObject, {
  ClientConnection: () => (ClientConnection),
  WispWebSocket: () => (WispWebSocket),
  _wisp_connections: () => (_wisp_connections)
});

;// external "ws"
const external_ws_namespaceObject = require("ws");
;// external "crypto"
const external_crypto_namespaceObject = require("crypto");
;// external "node:http"
const external_node_http_namespaceObject = require("node:http");
;// external "node:net"
const external_node_net_namespaceObject = require("node:net");
;// external "node:dgram"
const external_node_dgram_namespaceObject = require("node:dgram");
;// external "node:dns/promises"
const promises_namespaceObject = require("node:dns/promises");
;// ./src/compat.mjs
//this file contains references to external node modules
//it gets replaced with ./compat_browser.mjs when being bundled for the web

const global_this = globalThis;








;// ./src/packet.mjs
//shared packet parsing / serialization code

const text_encoder = new TextEncoder();
const encode_text = text_encoder.encode.bind(text_encoder);
const text_decoder = new TextDecoder();
const decode_text = text_decoder.decode.bind(text_decoder);

class WispBuffer {
  constructor(data) {
    if (data instanceof Uint8Array) {
      this.from_array(data);
    }
    else if (typeof data === "number") {
      this.from_array(new Uint8Array(data));
    }
    else if (typeof data === "string") {
      this.from_array(encode_text(data));
    }
    else {
      console.trace();
      throw "invalid data type passed to wisp buffer constructor";
    }
  }

  from_array(bytes) {
    this.size = bytes.length;
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); 
  }

  concat(buffer) {
    let new_buffer = new WispBuffer(this.size + buffer.size);
    new_buffer.bytes.set(this.bytes, 0);
    new_buffer.bytes.set(buffer.bytes, this.size);
    return new_buffer;
  }

  slice(index, size) {
    let bytes_slice = this.bytes.slice(index, size);
    return new WispBuffer(bytes_slice);
  }

  get_string() {
    return text_decoder.decode(this.bytes);
  }
}

class WispPacket {
  static min_size = 5;
  constructor({type, stream_id, payload, payload_bytes }) {
    this.type = type;
    this.stream_id = stream_id;
    this.payload_bytes = payload_bytes;
    this.payload = payload;
  }
  static parse(buffer) {
    return new WispPacket({
      type: buffer.view.getUint8(0),
      stream_id: buffer.view.getUint32(1, true),
      payload_bytes: buffer.slice(5)
    });
  }
  static parse_all(buffer) {
    if (buffer.size < WispPacket.min_size) {
      throw TypeError("packet too small");
    }
    let packet = WispPacket.parse(buffer);
    let payload_class = packet_classes[packet.type];
    if (typeof payload_class === "undefined") {
      throw TypeError("invalid packet type");
    }
    if (packet.payload_bytes.size < payload_class.size) {
      throw TypeError("payload too small");
    }
    packet.payload = payload_class.parse(packet.payload_bytes);
    return packet;
  }
  serialize() {
    let buffer = new WispBuffer(5);
    buffer.view.setUint8(0, this.type);
    buffer.view.setUint32(1, this.stream_id, true);
    buffer = buffer.concat(this.payload.serialize());
    return buffer;
  }
}

class ConnectPayload {
  static min_size = 3;
  static type = 0x01;
  static name = "CONNECT";
  constructor({stream_type, port, hostname}) {
    this.stream_type = stream_type;
    this.port = port;
    this.hostname = hostname;
  }
  static parse(buffer) {
    return new ConnectPayload({
      stream_type: buffer.view.getUint8(0),
      port: buffer.view.getUint16(1, true),
      hostname: decode_text(buffer.slice(3).bytes)
    });
  }
  serialize() {
    let buffer = new WispBuffer(3);
    buffer.view.setUint8(0, this.stream_type);
    buffer.view.setUint16(1, this.port, true);
    buffer = buffer.concat(new WispBuffer(this.hostname));
    return buffer;
  }
}

class DataPayload {
  static min_size = 0;
  static type = 0x02;
  static name = "DATA";
  constructor({data}) {
    this.data = data;
  }
  static parse(buffer) {
    return new DataPayload({
      data: buffer
    });
  }
  serialize() {
    return this.data;
  }
}

class ContinuePayload {
  static type = 0x03;
  static name = "CONTINUE";
  constructor({buffer_remaining}) {
    this.buffer_remaining = buffer_remaining;
  }
  static parse(buffer) {
    return new ContinuePayload({
      buffer_remaining: buffer.view.getUint32(0, true),
    });
  }
  serialize() {
    let buffer = new WispBuffer(4);
    buffer.view.setUint32(0, this.buffer_remaining, true);
    return buffer;
  }
}

class ClosePayload {
  static min_size = 1;
  static type = 0x04;
  static name = "CLOSE";
  constructor({reason}) {
    this.reason = reason;
  }
  static parse(buffer) {
    return new ClosePayload({
      reason: buffer.view.getUint8(0),
    });
  }
  serialize() {
    let buffer = new WispBuffer(1);
    buffer.view.setUint8(0, this.reason);
    return buffer;
  }
}

class InfoPayload {
  static min_size = 2;
  static type = 0x05;
  static name = "INFO";
  constructor({major_ver, minor_ver, extensions}) {
    this.major_ver = major_ver;
    this.minor_ver = minor_ver;
    this.extensions = extensions;
  }
  static parse(buffer) {
    return new InfoPayload({
      major_ver: buffer.view.getUint8(0),
      minor_ver: buffer.view.getUint8(1),
      extensions: buffer.slice(2)
    });
  }
  serialize() {
    let buffer = new WispBuffer(2);
    buffer.view.setUint8(0, this.major_ver);
    buffer.view.setUint8(1, this.minor_ver);
    return buffer.concat(this.extensions);
  }
}

const packet_classes = {
  0x01: ConnectPayload, 
  0x02: DataPayload, 
  0x03: ContinuePayload, 
  0x04: ClosePayload,
  0x05: InfoPayload
}

const packet_types = {
  CONNECT: 0x01,
  DATA: 0x02,
  CONTINUE: 0x03,
  CLOSE: 0x04,
  INFO: 0x05
}

const stream_types = {
  TCP: 0x01,
  UDP: 0x02
}

const close_reasons = {
  //client/server close reasons
  Unknown: 0x01,
  Voluntary: 0x02,
  NetworkError: 0x03,
  IncompatibleExtensions: 0x04,

  //server only close reasons
  InvalidInfo: 0x41, 
  UnreachableHost: 0x42,
  NoResponse: 0x43,
  ConnRefused: 0x44,
  TransferTimeout: 0x47,
  HostBlocked: 0x48,
  ConnThrottled: 0x49,

  //client only close reasons
  ClientError: 0x81,

  //extension specific close reasons
  AuthBadPassword: 0xc0,
  AuthBadSignature: 0xc1,
  AuthMissingCredentials: 0xc2
}
;// ./src/extensions.mjs


class EmptyPayload {
  constructor() {}
  static parse() {
    return new EmptyPayload();
  }
  serialize() {
    return new WispBuffer(0);
  }
}

class BaseExtension {
  static id = 0x00;
  static name = "";

  static Server = EmptyPayload;
  static Client = EmptyPayload;

  constructor({server_config, client_config} = {}) {
    this.id = this.constructor.id;
    this.name = this.constructor.name;
    if (server_config)
      this.payload = new this.constructor.Server(server_config);
    else if (client_config)
      this.payload = new this.constructor.Client(client_config);
  }
  static parse(ext_class, buffer, role) {
    let extension = new ext_class({});
    if (role === "client")
      extension.payload = ext_class.Client.parse(buffer.slice(5));
    else if (role === "server")
      extension.payload = ext_class.Server.parse(buffer.slice(5));
    else 
      throw TypeError("invalid role");
    return extension;
  }
  serialize() {
    let buffer = new WispBuffer(5);
    let payload_buffer = this.payload.serialize();
    buffer.view.setInt8(0, this.constructor.id);
    buffer.view.setUint32(1, payload_buffer.size, true);
    return buffer.concat(payload_buffer);
  }
}

class UDPExtension extends BaseExtension {
  static id = 0x01;
  static name = "UDP";
}

class PasswordAuthExtension extends BaseExtension {
  static id = 0x02;
  static name = "Password Authentication";

  static Server = class {
    constructor({required = 1}) {
      this.required = required ? 1 : 0;
    }
    static parse(buffer) {
      return new PasswordAuthExtension.Server({
        required: buffer.view.getUint8(0)
      });
    }
    serialize() {
      let buffer = new WispBuffer(1);
      buffer.view.setUint8(0, this.required);
      return buffer;
    }
  }

  static Client = class {
    constructor({username, password}) {
      this.username = username;
      this.password = password;
    }
    static parse(buffer) {
      let username_len = buffer.view.getUint8(0);
      let password_len = buffer.view.getUint16(1, true);
      let password_index = username_len + 3;
      return new PasswordAuthExtension.Client({
        username: buffer.slice(3, username_len).get_string(),
        password: buffer.slice(password_index, password_len).get_string()
      });
    }
    serialize() {
      let username_buffer = new WispBuffer(this.username);
      let password_buffer = new WispBuffer(this.password);
      let buffer = new WispBuffer(3);
      buffer.view.setUint8(0, username_buffer.size);
      buffer.view.setUint16(1, password_buffer.size, true);
      return buffer.concat(username_buffer).concat(password_buffer);
    }
  }
}

class MOTDExtension extends BaseExtension {
  static id = 0x04;
  static name = "Server MOTD";

  static Server = class {
    constructor({message}) {
      this.message = message;
    }
    static parse(buffer) {
      return new MOTDExtension.Server({
        message: buffer.get_string()
      });
    }
    serialize() {
      return new WispBuffer(this.message);
    }
  }

  static Client = EmptyPayload;
}

function parse_extensions(payload_buffer, valid_extensions, role) {
  let index = 0;
  let parsed_extensions = [];
  while (payload_buffer.size) {
    let ext_id = payload_buffer.view.getUint8(index);
    let ext_len = payload_buffer.view.getUint32(index + 1, true);
    let ext_payload = payload_buffer.slice(0, 5 + ext_len);
    let ext_class;
    for (let extension of valid_extensions) {
      if (extension.id !== ext_id) 
        continue;
      ext_class = extension.constructor;
      break;
    }
    if (ext_class) {
      let ext_parsed = BaseExtension.parse(ext_class, ext_payload, role);
      parsed_extensions.push(ext_parsed);
    }
    payload_buffer = payload_buffer.slice(5 + ext_len);
  }
  return parsed_extensions;
}

function serialize_extensions(extensions) {{
  let ext_buffer = new WispBuffer(0);
  for (let extension of extensions) {
    ext_buffer = ext_buffer.concat(extension.serialize());
  }
  return ext_buffer;
}}

const extensions_map = {
  0x01: UDPExtension,
  0x02: PasswordAuthExtension,
  0x04: MOTDExtension
}
;// ./src/client/connection.mjs






class ClientStream {
  constructor(hostname, port, websocket, connection, stream_id, stream_type, buffer_size) {
    this.hostname = hostname;
    this.port = port;
    this.ws = websocket;
    this.connection = connection;
    this.stream_id = stream_id;
    this.stream_type = stream_type;
    this.buffer_size = buffer_size;
    this.send_buffer = [];
    this.open = true;

    this.onopen = () => {};
    this.onclose = () => {};
    this.onmessage = () => {};
  }

  send(data) {
    //note: udp shouldn't buffer anything
    if (this.buffer_size > 0 || !this.open || this.stream_type === stream_types.UDP) {
      //construct and send a DATA packet
      let packet = new WispPacket({
        type: packet_types.DATA,
        stream_id: this.stream_id,
        payload: new DataPayload({
          data: new WispBuffer(data)
        })
      });
      this.ws.send(packet.serialize().bytes);
      this.buffer_size--;
    }
    else { //server is slow, don't send data yet
      this.send_buffer.push(data);
    }
  }

  //handle receiving a CONTINUE packet
  continue_received(buffer_size) {
    this.buffer_size = buffer_size;
    //send buffered data now
    while (this.buffer_size > 0 && this.send_buffer.length > 0) {
      this.send(this.send_buffer.shift());
    }
  }

  //construct and send a CLOSE packet
  close(reason = 0x01) {
    if (!this.open) return;
    let packet = new WispPacket({
      type: packet_types.CLOSE,
      stream_id: this.stream_id,
      payload: new ClosePayload({
        reason: reason
      })
    });
    this.ws.send(packet.serialize().bytes);
    this.open = false;
    delete this.connection.active_streams[this.stream_id];
  }
}

class ClientConnection {
  constructor(wisp_url, {wisp_version, wisp_extensions} = {}) {
    if (!wisp_url.endsWith("/")) {
      throw new TypeError("wisp endpoints must end with a trailing forward slash");
    }

    this.wisp_url = wisp_url;
    this.wisp_version = wisp_version || 2;
    this.wisp_extensions = wisp_extensions || null;

    this.max_buffer_size = null;
    this.active_streams = {};
    this.connected = false;
    this.connecting = false;
    this.next_stream_id = 1;

    this.server_exts = {};
    this.client_exts = {};
    this.info_received = false;
    this.server_motd = null;
    this.udp_enabled = true;

    this.onopen = () => {};
    this.onclose = () => {};
    this.onerror = () => {};
    this.onmessage = () => {};

    if (this.wisp_version === 2 && this.wisp_extensions === null) {
      this.add_extensions();
    }

    this.connect_ws();
  }

  add_extensions() {
    this.wisp_extensions = [];
    this.wisp_extensions.push(new UDPExtension({client_config: {}}));
    this.wisp_extensions.push(new MOTDExtension({client_config: {}}));
  }

  connect_ws() {
    let subprotocol = this.wisp_version === 2 ? "wisp-v2" : undefined;
    this.ws = new external_ws_namespaceObject.WebSocket(this.wisp_url, subprotocol);
    this.ws.binaryType = "arraybuffer";
    this.connecting = true;

    this.ws.onmessage = (event) => {
      this.on_ws_msg(event);
      if (this.connected && this.connecting) {
        this.connecting = false;
        this.onopen();
      }
    };
    this.ws.onclose = () => {
      this.cleanup();
      this.onclose();
    };
    this.ws.onerror = () => {
      if (this.wisp_version === 2) {
        // try falling back to wisp v1 if the server doesn't support v2
        this.ws.onclose = null;
        this.cleanup();
        this.wisp_version = 1;
        this.connect_ws();
        return;
      }
      this.cleanup();
      this.onerror();
    };
  }

  on_ws_msg(event) {
    let buffer = new WispBuffer(new Uint8Array(event.data));
    if (buffer.size < WispPacket.min_size) {
      console.warn(`wisp client warning: received a packet which is too short`);
      return;
    }
    let packet = WispPacket.parse_all(buffer);
    let stream = this.active_streams[packet.stream_id];
    if (packet.stream_id === 0 && this.connecting) {
      if (packet.type === packet_types.CONTINUE) {
        this.max_buffer_size = packet.payload.buffer_remaining;
        this.connected = true;
        if (!this.info_received) {
          this.wisp_version = 1;
        }
      }
      
      if (packet.type === packet_types.INFO && this.wisp_version === 2) {
        let server_extensions = parse_extensions(packet.payload.extensions, this.wisp_extensions, "server");
        for (let server_ext of server_extensions) {
          for (let client_ext of this.wisp_extensions) {
            if (server_ext.id === client_ext.id) {
              this.server_exts[server_ext.id] = server_ext;
              this.client_exts[client_ext.id] = client_ext;
            }
          }
        }

        this.info_received = true; 
        this.server_motd = this.server_exts[MOTDExtension.id]?.payload?.message;
        this.udp_enabled = !!this.server_exts[UDPExtension.id];

        let ext_buffer = serialize_extensions(this.wisp_extensions);
        let info_packet = new WispPacket({
          type: InfoPayload.type,
          stream_id: 0,
          payload: new InfoPayload({
            major_ver: this.wisp_version,
            minor_ver: 0,
            extensions: ext_buffer
          })
        });
        this.ws.send(info_packet.serialize().bytes);
      }
      return;
    }

    if (typeof stream === "undefined") {
      console.warn(`wisp client warning: received a ${packet_classes[packet.type].name} packet for a stream which doesn't exist`);
      return;
    }

    if (packet.type === packet_types.DATA) {
      stream.onmessage(packet.payload_bytes.bytes);
    }

    else if (packet.type === packet_types.CONTINUE) { //other CONTINUE packets
      stream.continue_received(packet.payload.buffer_remaining);
    }

    else if (packet.type === packet_types.CLOSE) {
      this.close_stream(stream, packet.payload.reason);
    }

    else {
      console.warn(`wisp client warning: received an invalid packet of type ${packet.type}`);
    }
  }

  close() {
    this.ws.close();
  }

  cleanup() {
    this.connected = false;
    this.connecting = false;
    for (let stream_id of Object.keys(this.active_streams)) {
      this.close_stream(this.active_streams[stream_id], 0x03);
    }
  }

  create_stream(hostname, port, type=0x01) {
    let stream_type = type;
    if (typeof stream_type === "string") 
      stream_type = type === "udp" ? stream_types.UDP : stream_types.TCP;

    if (stream_type == stream_types.UDP && !this.udp_enabled) {
      throw new Error("udp is not enabled for this wisp connection");
    }

    const stream_id = this.next_stream_id++;
    const stream = new ClientStream(hostname, port, this.ws, this, stream_id, stream_type, this.max_buffer_size);
    this.active_streams[stream_id] = stream;
    stream.open = this.connected;

    //construct CONNECT packet
    const packet = new WispPacket({
      type: packet_types.CONNECT,
      stream_id: stream_id,
      payload: new ConnectPayload({
        stream_type: stream_type,
        port: port,
        hostname: hostname
      })
    });
    this.ws.send(packet.serialize().bytes);
    return stream;
  }

  close_stream(stream, reason) {
    stream.onclose(reason);
    delete this.active_streams[stream.stream_id];
  }
}


;// ./src/client/polyfill.mjs



//polyfill the DOM Websocket API so that applications using wsproxy can easily use wisp with minimal changes

const RealCloseEvent = (global_this.CloseEvent || Event);
const _wisp_connections = {};

class WispWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url, protocols=null, options = {}) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    this.binaryType = "blob";
    this.stream = null;
    this.connection = null;

    //legacy event handlers
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;

    this._ready_state = this.CONNECTING;

    //parse the wsproxy url
    let url_split = this.url.split("/");
    let wsproxy_path = url_split.pop().split(":");
    this.host = wsproxy_path[0];
    this.port = parseInt(wsproxy_path[1]);
    this.real_url = url_split.join("/") + "/";

    this.init_connection();
  }

  fake_event_send(event) {
    this["on" + event.type]?.(event);
    this.dispatchEvent(event);
	};

  init_connection() {
    //create the stream
    this.connection = _wisp_connections[this.real_url];

    if (!this.connection) {
      this.connection = new ClientConnection(this.real_url, this.options);
      this.connection.onopen = () => {
        this.init_stream();
      };
      this.connection.onclose = () => {
        this.on_conn_close()
      };
      this.connection.onerror = () => {
        this.on_conn_close()
      };
      _wisp_connections[this.real_url] = this.connection;
    }
    else if (!this.connection.connected) {
      let old_onopen = this.connection.onopen;
      this.connection.onopen = () => {
        old_onopen();
        this.init_stream();
      };
    }
    else {
      this.connection = _wisp_connections[this.real_url];
      this.init_stream();
    }
  }

  on_conn_close() {
    this._ready_state = this.CLOSED;
    if (_wisp_connections[this.real_url]) {
      this.fake_event_send(new Event("error"));
    }
    delete _wisp_connections[this.real_url];
  }

  init_stream() {
    this._ready_state = this.OPEN;
    this.stream = this.connection.create_stream(this.host, this.port);

    this.stream.onmessage = (raw_data) => {
      let data;
      if (this.binaryType == "blob") {
        data = new Blob(raw_data);
      }
      else if (this.binaryType == "arraybuffer") {
        data = raw_data.buffer;
      }
      else {
        throw "invalid binaryType string";
      }
      this.fake_event_send(new MessageEvent("message", {data: data}));
    };

    this.stream.onclose = (reason) => {
      this._ready_state = this.CLOSED;
      this.fake_event_send(new RealCloseEvent("close", {code: reason}));
    };

    this.fake_event_send(new Event("open"));
  }

  send(data) {
    let data_array;

    if (data instanceof Uint8Array) {
      data_array = data;  
    }
    else if (typeof data === "string") {
      data_array = new TextEncoder().encode(data);
    }
    else if (data instanceof Blob) {
      data.arrayBuffer().then(array_buffer => {
        this.send(array_buffer);
      });
      return;
    }
    else if (data instanceof ArrayBuffer) {
      data_array = new Uint8Array(data);
    }
    //dataview objects or any other typedarray
    else if (ArrayBuffer.isView(data)) {
      data_array = new Uint8Array(data.buffer);
    }
    else {
      throw "invalid data type to be sent";
    }

    if (!this.stream) {
      throw "websocket is not ready";
    }
    this.stream.send(data_array);
  }

  close() {
    this.stream.close(0x02);
  }

  get bufferedAmount() {
    let total = 0;
    for (const msg of this.stream.send_buffer) {
      total += msg.length;
    }
    return total;
  }

  get extensions() {
    return "";
  }

  get protocol() {
    return "binary";
  }

  get readyState() {
    return this._ready_state;
  }
}
;// ./src/client/index.mjs


;// ./src/entrypoints/client.mjs



const __webpack_export_target__ = exports;
for(var __webpack_i__ in __webpack_exports__) __webpack_export_target__[__webpack_i__] = __webpack_exports__[__webpack_i__];
if(__webpack_exports__.__esModule) Object.defineProperty(__webpack_export_target__, "__esModule", { value: true });
/******/ })()
;
//# sourceMappingURL=wisp-client.cjs.map