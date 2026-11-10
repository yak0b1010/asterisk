"""Small loopback SIP/RTP smoke peer; not a general-purpose SIP implementation."""
import hashlib
import re
import select
import socket
import struct
import time
import uuid

PBX = ("127.0.0.1", 5060)


def parse(packet):
    head, _, body = packet.decode().partition("\r\n\r\n")
    lines = head.split("\r\n")
    headers = {}
    for line in lines[1:]:
        key, _, value = line.partition(":")
        headers[key.lower()] = value.strip()
    return lines[0], headers, body


def digest(challenge, number, password, method, uri):
    fields = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
    md5 = lambda value: hashlib.md5(value.encode()).hexdigest()
    realm, nonce = fields["realm"], fields["nonce"]
    ha1, ha2 = md5(f"{number}:{realm}:{password}"), md5(f"{method}:{uri}")
    # Asterisk challenges advertise qop=auth.
    cnonce = uuid.uuid4().hex
    response = md5(f"{ha1}:{nonce}:00000001:{cnonce}:auth:{ha2}")
    return (f'Digest username="{number}", realm="{realm}", nonce="{nonce}", uri="{uri}", '
            f'response="{response}", algorithm=MD5, qop=auth, nc=00000001, cnonce="{cnonce}"')


class Peer:
    def __init__(self, number):
        self.number = number
        self.sip = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sip.bind(("127.0.0.1", 0))
        self.sip.settimeout(5)
        self.rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.rtp.bind(("127.0.0.1", 0))
        self.contact = f"sip:{number}@127.0.0.1:{self.sip.getsockname()[1]}"
        self.tag = uuid.uuid4().hex
        self.call_id = uuid.uuid4().hex
        self.to = f"<sip:7002@127.0.0.1>"
        self.media = None
        self.received = 0

    def sdp(self):
        return (f"v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=smoke\r\nc=IN IP4 127.0.0.1\r\n"
                f"t=0 0\r\nm=audio {self.rtp.getsockname()[1]} RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n")

    def request(self, method, uri, cseq, auth="", body=""):
        packet = (
            f"{method} {uri} SIP/2.0\r\n"
            f"Via: SIP/2.0/UDP 127.0.0.1:{self.sip.getsockname()[1]};branch=z9hG4bK{uuid.uuid4().hex};rport\r\n"
            f"From: <sip:{self.number}@127.0.0.1>;tag={self.tag}\r\nTo: {self.to}\r\n"
            f"Call-ID: {self.call_id}\r\nCSeq: {cseq} {method}\r\n"
            f"Contact: <{self.contact}>\r\nMax-Forwards: 70\r\nExpires: 120\r\n"
            + (f"Authorization: {auth}\r\n" if auth else "")
            + ("Content-Type: application/sdp\r\n" if body else "")
            + f"Content-Length: {len(body.encode())}\r\n\r\n{body}"
        )
        self.sip.sendto(packet.encode(), PBX)

    def reply(self, headers, address, code="200 OK", body=""):
        packet = f"SIP/2.0 {code}\r\n"
        for key in ("via", "from", "to", "call-id", "cseq"):
            value = headers[key]
            if key == "to" and "tag=" not in value:
                value += ";tag=" + self.tag
            packet += f"{key}: {value}\r\n"
        packet += f"Contact: <{self.contact}>\r\n"
        if body:
            packet += "Content-Type: application/sdp\r\n"
        packet += f"Content-Length: {len(body.encode())}\r\n\r\n{body}"
        self.sip.sendto(packet.encode(), address)

    def set_media(self, body):
        ip = re.search(r"c=IN IP4 ([^\r\n]+)", body)[1]
        port = int(re.search(r"m=audio (\d+)", body)[1])
        self.media = (ip, port)

    def register(self, password):
        uri = "sip:127.0.0.1"
        self.to = f"<sip:{self.number}@127.0.0.1>"
        self.request("REGISTER", uri, 1)
        while True:
            status, headers, _ = parse(self.sip.recvfrom(65535)[0])
            if status.startswith("SIP/2.0 401"):
                self.request("REGISTER", uri, 2, digest(headers["www-authenticate"], self.number, password, "REGISTER", uri))
            elif status.startswith("SIP/2.0 200"):
                return
            else:
                raise AssertionError("REGISTER: " + status)

    def close(self):
        self.sip.close()
        self.rtp.close()


def exercise_call(password):
    caller, callee = Peer("7001"), Peer("7002")
    try:
        caller.register(password)
        callee.register(password)
        caller.call_id = uuid.uuid4().hex
        caller.to = "<sip:7002@127.0.0.1>"
        uri, cseq = "sip:7002@127.0.0.1", 1
        caller.request("INVITE", uri, cseq, body=caller.sdp())
        deadline = time.monotonic() + 15
        answered_at = None
        bye_sent = False
        sequence = 0
        while time.monotonic() < deadline:
            sockets = [caller.sip, callee.sip, caller.rtp, callee.rtp]
            ready, _, _ = select.select(sockets, [], [], 0.02)
            for peer in (caller, callee):
                if peer.rtp in ready:
                    peer.rtp.recvfrom(65535)
                    peer.received += 1
                if peer.sip not in ready:
                    continue
                packet, address = peer.sip.recvfrom(65535)
                status, headers, body = parse(packet)
                if peer is caller and status.startswith("SIP/2.0 401"):
                    caller.request("ACK", uri, cseq)
                    cseq += 1
                    caller.request("INVITE", uri, cseq,
                                   digest(headers["www-authenticate"], "7001", password, "INVITE", uri),
                                   caller.sdp())
                elif peer is callee and status.startswith("INVITE "):
                    callee.set_media(body)
                    callee.reply(headers, address, body=callee.sdp())
                elif peer is caller and status.startswith("SIP/2.0 200"):
                    if headers["cseq"].endswith("INVITE"):
                        caller.to = headers["to"]
                        uri = headers["contact"].strip("<>")
                        caller.set_media(body)
                        caller.request("ACK", uri, cseq)
                        answered_at = answered_at or time.monotonic()
                    elif headers["cseq"].endswith("BYE"):
                        assert min(caller.received, callee.received) > 0, "RTP missing in one direction"
                        return
                elif status.startswith("BYE "):
                    peer.reply(headers, address)
                elif status.startswith(("OPTIONS ", "NOTIFY ")):
                    peer.reply(headers, address)
                elif status.startswith("SIP/2.0 ") and int(status.split()[1]) >= 400:
                    raise AssertionError("INVITE: " + status)
            if answered_at and not bye_sent:
                for peer in (caller, callee):
                    if peer.media:
                        packet = struct.pack("!BBHII", 0x80, 0, sequence % 65536, sequence * 160, 1234) + b"\xff" * 160
                        peer.rtp.sendto(packet, peer.media)
                sequence += 1
                if time.monotonic() - answered_at > 2:
                    caller.request("BYE", uri, cseq + 1)
                    bye_sent = True
        raise AssertionError("SIP call did not finish")
    finally:
        caller.close()
        callee.close()
