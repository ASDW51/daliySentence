import requests
import time
import json
import hmac
import hashlib
import base64
import urllib.parse
import datetime
import os


def robot_s(test):
    # server酱
    times = time.strftime("%Y年%m月%d日%H时%M分%S秒", time.localtime())
    # 获取环境变量设置的server酱密钥
    secret = os.environ['secret']
    server_url = f'https://sc.ftqq.com/{secret}.send?text={times + text}&desp='
    server_url += test
    # print(times)
    response = requests.get(server_url)
    # print(response.text)


def robot_ding(test):
    timestamp = str(round(time.time() * 1000))
    secret = os.environ['ddsecret']
    token = os.environ['ddtoken']
    secret_enc = secret.encode('utf-8')
    string_to_sign = '{}\n{}'.format(timestamp, secret)
    string_to_sign_enc = string_to_sign.encode('utf-8')
    hmac_code = hmac.new(secret_enc, string_to_sign_enc, digestmod=hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))

    url = f'https://oapi.dingtalk.com/robot/send?access_token={token}&timestamp={timestamp}&sign={sign}'
    data = {
        "msgtype": "text",
        "text": {
            "content": test
        }
    }
    hd = {
        'Content-Type': 'application/json; charset=UTF-8'
    }
    response = requests.post(url, data=json.dumps(data), headers=hd)
    response.encoding = 'utf-8'
    # print(response.text)


def write_readme(obj):
    times = time.strftime("%Y/%m/%d", time.localtime())
    str = f'''
### {times}
```
    {obj['content']}\n
    {obj['note']}
```
'''
    with open("./README.md",'a+',encoding="utf-8") as file:
        file.write(str)
    print(str)
    return


now_time = int(time.time() * 1000)
daily_sentence_url = f'http://sentence.iciba.com/index.php?callback=&c=dailysentence&m=getTodaySentence&_={now_time}'
daily_response = requests.get(daily_sentence_url)
daily_data = daily_response.text
new_daily_data = json.loads(daily_data)
text = f'当前时间：{time.strftime("%Y/%m/%d %H:%M:%S", time.localtime())}\n每日一句 {new_daily_data["title"]}\n{new_daily_data["content"]}\n{new_daily_data["note"]}'
# print(text)
robot_s(text)
robot_ding(text)
write_readme(new_daily_data)
