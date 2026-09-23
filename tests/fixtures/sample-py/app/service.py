import os


class Service:
    def handle(self, payload):
        return payload


def build():
    return Service()
