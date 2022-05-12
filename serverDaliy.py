import requests
import time
import json
import os


def robot(test):
    # server酱
    times = time.strftime("%Y年%m月%d日%H时%M分%S秒", time.localtime())
    # 获取环境变量设置的server酱密钥
    secret = os.environ['secret']
    server_url = f'https://sc.ftqq.com/{secret}.send?text={times+text}&desp='
    server_url += test
    print(times)
    response = requests.get(server_url)
    # print(response.text)

now_time = int(time.time() * 1000)
daily_sentence_url = f'http://sentence.iciba.com/index.php?callback=&c=dailysentence&m=getTodaySentence&_={now_time}'
daily_response = requests.get(daily_sentence_url)
daily_data = daily_response.text
new_daily_data = json.loads(daily_data)
text = f'每日一句 {new_daily_data["title"]}\n{new_daily_data["content"]}\n{new_daily_data["note"]}'
robot(text)
